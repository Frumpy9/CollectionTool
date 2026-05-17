import { randomUUID } from "node:crypto";
import type {
  CardLanguage,
  CardLookupCandidate,
  CardLookupResponse,
  CreateInventoryItemRequest
} from "@collection-tool/shared";
import type { AppDatabase } from "./db.js";
import { japanesePokemonNameMap } from "./japanesePokemonNames.js";

type CardLookupOptions = {
  query: string;
  language: CardLanguage | "all";
  pokemonTcgApiKey: string;
  database: AppDatabase;
};

type ParsedCardQuery = CardLookupResponse["parsed"];

type PokemonTcgCard = {
  id: string;
  name: string;
  number?: string;
  rarity?: string;
  set?: {
    id?: string;
    name?: string;
    series?: string;
    releaseDate?: string;
    printedTotal?: number;
    total?: number;
  };
  images?: {
    small?: string;
    large?: string;
  };
};

type TcgdexCard = {
  id?: string;
  name?: string;
  localId?: string;
  image?: string;
  rarity?: string;
  set?: {
    id?: string;
    name?: string;
    releaseDate?: string;
  };
};

type JapaneseCacheRow = {
  id: string;
  source: string;
  source_id: string;
  set_code: string;
  set_name: string | null;
  card_number: string;
  printed_number: string;
  printed_total: string | null;
  name: string;
  rarity: string | null;
  image_url: string | null;
};

type OfficialJapaneseSearchResponse = {
  result?: number;
  maxPage?: number;
  searchCondition?: string[];
  cardList?: OfficialJapaneseSearchCard[];
};

type OfficialJapaneseSearchCard = {
  cardID?: string;
  cardThumbFile?: string;
  cardNameAltText?: string;
  cardNameViewText?: string;
};

type OfficialJapaneseCardDetail = {
  sourceId: string;
  setCode: string;
  setName: string | null;
  cardNumber: string;
  printedNumber: string;
  printedTotal: string | null;
  name: string;
  japaneseName: string;
  rarity: string | null;
  imageUrl: string | null;
  rawPayload: string;
};

type PokeApiSpeciesResponse = {
  names?: Array<{
    name?: string;
    language?: {
      name?: string;
    };
  }>;
};

const pokemonTcgBaseUrl = "https://api.pokemontcg.io/v2";
const tcgdexBaseUrl = "https://api.tcgdex.net/v2";
const pokemonCardJpBaseUrl = "https://www.pokemon-card.com";
const limitlessBaseUrl = "https://limitlesstcg.com";
const pokeApiBaseUrl = "https://pokeapi.co/api/v2";
const officialJapaneseProductIds: Record<string, string> = {
  cp3: "431"
};

export async function lookupCards({
  query,
  language,
  pokemonTcgApiKey,
  database
}: CardLookupOptions): Promise<CardLookupResponse> {
  const normalizedQuery = query.trim();
  const parsed = parseCardQuery(normalizedQuery);
  const lookupTasks: Array<Promise<CardLookupCandidate[]>> = [];
  const cachedCandidates: CardLookupCandidate[] = [];

  if (language === "all" || language === "en") {
    lookupTasks.push(lookupPokemonTcgCards(parsed, normalizedQuery, pokemonTcgApiKey));
    lookupTasks.push(lookupTcgdexCards("en", parsed, normalizedQuery));
  }

  if (language === "all" || language === "ja") {
    cachedCandidates.push(...lookupJapaneseCacheCards(database, parsed, normalizedQuery));

    if (cachedCandidates.length === 0) {
      lookupTasks.push(lookupOfficialJapaneseCards(database, parsed, normalizedQuery));
    }

    lookupTasks.push(lookupTcgdexCards("ja", parsed, normalizedQuery));
  }

  const settled = await Promise.allSettled(lookupTasks);
  const candidates = cachedCandidates.concat(
    settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
  );

  const dedupedCandidates = dedupeCandidates(candidates);

  return {
    query: normalizedQuery,
    parsed,
    candidates: (
      dedupedCandidates.length > 0
        ? dedupedCandidates
        : buildParsedFallbackCandidate(parsed)
    ).slice(0, 12)
  };
}

export function parseCardQuery(query: string): ParsedCardQuery {
  const normalized = query.trim();
  const setNumberMatch = normalized.match(
    /^([a-z0-9][a-z0-9-]{1,18})[\s#-]+((?=[a-z0-9/]*\d)[a-z0-9]+(?:\/[a-z0-9]+)?)$/i
  );

  if (setNumberMatch) {
    return {
      kind: "set-number",
      setCode: setNumberMatch[1].toLowerCase(),
      cardNumber: setNumberMatch[2],
      ...splitCardNumber(setNumberMatch[2])
    };
  }

  if (/^[a-z]*\d+[a-z]*(?:\/[a-z0-9]+)?$/i.test(normalized)) {
    return {
      kind: "number",
      setCode: null,
      cardNumber: normalized,
      ...splitCardNumber(normalized)
    };
  }

  return {
    kind: "name",
    setCode: null,
    cardNumber: null,
    printedNumber: null,
    setTotal: null,
    localId: null
  };
}

async function lookupPokemonTcgCards(
  parsed: ParsedCardQuery,
  query: string,
  apiKey: string
): Promise<CardLookupCandidate[]> {
  if (!apiKey) {
    return [];
  }

  const q = buildPokemonTcgQuery(parsed, query);

  if (!q) {
    return [];
  }

  const response = await fetch(
    `${pokemonTcgBaseUrl}/cards?q=${encodeURIComponent(q)}&pageSize=${pokemonTcgPageSize(
      parsed
    )}&orderBy=set.releaseDate`,
    {
      headers: {
        "X-Api-Key": apiKey,
        accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { data?: PokemonTcgCard[] };

  return (payload.data ?? []).map((card) => mapPokemonTcgCard(card, parsed));
}

async function lookupTcgdexCards(
  language: "en" | "ja",
  parsed: ParsedCardQuery,
  query: string
): Promise<CardLookupCandidate[]> {
  if (parsed.kind === "set-number" && parsed.setCode && parsed.localId) {
    const direct = await fetchFirstTcgdexCard(
      language,
      parsed.setCode,
      parsed.localId,
      parsed.printedNumber
    );

    return direct ? [mapTcgdexCard(direct, language, parsed)] : [];
  }

  if (parsed.kind === "name" && query.length >= 2) {
    const response = await fetch(
      `${tcgdexBaseUrl}/${language}/cards?name=${encodeURIComponent(query)}`
    );

    if (!response.ok) {
      return [];
    }

    const cards = (await response.json()) as TcgdexCard[];
    const detailed = await Promise.all(
      cards.slice(0, 8).map((card) => fetchTcgdexCardById(language, card.id))
    );

    return detailed
      .filter((card): card is TcgdexCard => Boolean(card))
      .map((card) => mapTcgdexCard(card, language, parsed));
  }

  return [];
}

async function fetchTcgdexCard(language: "en" | "ja", setCode: string, localId: string) {
  const response = await fetch(
    `${tcgdexBaseUrl}/${language}/sets/${encodeURIComponent(setCode)}/${encodeURIComponent(
      localId
    )}`
  );

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as TcgdexCard;
}

async function fetchFirstTcgdexCard(
  language: "en" | "ja",
  setCode: string,
  ...localIds: Array<string | null | undefined>
) {
  const attempted = new Set<string>();

  for (const localId of localIds) {
    if (!localId || attempted.has(localId)) {
      continue;
    }

    attempted.add(localId);

    const card = await fetchTcgdexCard(language, setCode, localId);

    if (card) {
      return card;
    }
  }

  return null;
}

async function fetchTcgdexCardById(language: "en" | "ja", cardId: string | undefined) {
  if (!cardId) {
    return null;
  }

  const response = await fetch(`${tcgdexBaseUrl}/${language}/cards/${encodeURIComponent(cardId)}`);

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as TcgdexCard;
}

function buildPokemonTcgQuery(parsed: ParsedCardQuery, query: string) {
  if (parsed.kind === "set-number" && parsed.setCode && parsed.cardNumber) {
    return [
      `set.id:${escapePokemonTcgTerm(parsed.setCode)}`,
      `number:${escapePokemonTcgTerm(parsed.printedNumber ?? parsed.cardNumber)}`,
      printedTotalQuery(parsed)
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (parsed.kind === "number" && parsed.cardNumber) {
    return [
      `number:${escapePokemonTcgTerm(parsed.printedNumber ?? parsed.cardNumber)}`,
      printedTotalQuery(parsed)
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (query.length >= 2) {
    const nameTerms = pokemonTcgNameTerms(query);

    return nameTerms.length > 0 ? nameTerms.map((term) => `name:${term}*`).join(" ") : null;
  }

  return null;
}

function pokemonTcgPageSize(parsed: ParsedCardQuery) {
  return parsed.kind === "number" && parsed.setTotal ? 50 : 12;
}

function printedTotalQuery(parsed: ParsedCardQuery) {
  return parsed.setTotal ? `set.printedTotal:${escapePokemonTcgTerm(parsed.setTotal)}` : null;
}

function mapPokemonTcgCard(card: PokemonTcgCard, parsed: ParsedCardQuery): CardLookupCandidate {
  const imageUrl = card.images?.large ?? card.images?.small ?? null;
  const item = buildInventoryItem({
    name: card.name,
    setName: card.set?.name ?? null,
    setCode: card.set?.id ?? null,
    cardNumber: displayCardNumber(card.number, card.set?.printedTotal) ?? null,
    language: "en",
    rarity: card.rarity ?? null,
    imageUrl,
    releaseYear: releaseYearFromDate(card.set?.releaseDate),
    sourceLabel: `PokemonTCG.io ID: ${card.id}`
  });

  return {
    id: `pokemontcg:${card.id}`,
    source: "pokemontcg",
    sourceId: card.id,
    confidence: confidenceForCard(card.set?.id, card.number, parsed, card.set?.printedTotal),
    name: card.name,
    setName: card.set?.name ?? null,
    setCode: card.set?.id ?? null,
    cardNumber: displayCardNumber(card.number, card.set?.printedTotal) ?? null,
    language: "en",
    rarity: card.rarity ?? null,
    imageUrl,
    item,
    score: scoreGenericCard(card.set?.id, card.number, parsed, card.set?.printedTotal)
  };
}

function mapTcgdexCard(
  card: TcgdexCard,
  language: CardLanguage,
  parsed: ParsedCardQuery
): CardLookupCandidate {
  const sourceId = card.id ?? [card.set?.id, card.localId].filter(Boolean).join("-");
  const imageUrl = card.image ? `${card.image}/high.webp` : null;
  const name = translateCardName(card.name ?? "Unknown card", language);
  const item = buildInventoryItem({
    name,
    setName: card.set?.name ?? null,
    setCode: card.set?.id ?? null,
    cardNumber: card.localId ?? null,
    language,
    rarity: card.rarity ?? null,
    imageUrl,
    releaseYear: releaseYearFromDate(card.set?.releaseDate),
    sourceLabel: `TCGdex ID: ${sourceId}`
  });

  return {
    id: `tcgdex:${language}:${sourceId}`,
    source: "tcgdex",
    sourceId,
    confidence: confidenceForCard(card.set?.id, card.localId, parsed),
    name,
    setName: card.set?.name ?? null,
    setCode: card.set?.id ?? null,
    cardNumber: card.localId ?? null,
    language,
    rarity: card.rarity ?? null,
    imageUrl,
    item,
    score: scoreGenericCard(card.set?.id, card.localId, parsed)
  };
}

async function lookupOfficialJapaneseCards(
  database: AppDatabase,
  parsed: ParsedCardQuery,
  query: string
): Promise<CardLookupCandidate[]> {
  if (parsed.kind !== "set-number" || !parsed.setCode || !parsed.printedNumber) {
    return [];
  }

  const importedCount = await importOfficialJapaneseSet(database, parsed);

  if (importedCount > 0) {
    const candidates = lookupJapaneseCacheCards(database, parsed, query);

    if (candidates.length > 0) {
      return candidates;
    }
  }

  const detail = await fetchLimitlessJapaneseCard(parsed);

  if (!detail) {
    return [];
  }

  upsertJapaneseCacheDetails(database, [detail], "limitless");

  return lookupJapaneseCacheCards(database, parsed, query);
}

async function importOfficialJapaneseSet(database: AppDatabase, parsed: ParsedCardQuery) {
  if (!parsed.setCode) {
    return 0;
  }

  const setCode = parsed.setCode;
  const product = await fetchOfficialJapaneseProduct(setCode);

  if (!product) {
    return 0;
  }

  const listingCards = await fetchOfficialJapaneseProductCards(product.productId);

  if (listingCards.length === 0) {
    return 0;
  }

  const details = await mapWithConcurrency(listingCards, 8, async (card) => {
    if (!card.cardID) {
      return null;
    }

    return fetchOfficialJapaneseCardDetail(card.cardID, setCode, product.setName);
  });

  const validDetails = details.filter(
    (detail): detail is OfficialJapaneseCardDetail =>
      detail !== null && detail.setCode.toLowerCase() === setCode.toLowerCase()
  );

  upsertJapaneseCacheDetails(database, validDetails);

  return validDetails.length;
}

async function fetchOfficialJapaneseProduct(setCode: string) {
  const mappedProductId = officialJapaneseProductIds[setCode.toLowerCase()];

  if (mappedProductId) {
    return {
      productId: mappedProductId,
      setName: null
    };
  }

  const response = await fetch(`${pokemonCardJpBaseUrl}/ex/${encodeURIComponent(setCode)}/`);

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const productId = matchFirst(html, /card-search\/index\.php\?[^"'<>]*pg=(\d+)/i);

  if (!productId) {
    return null;
  }

  const title = matchFirst(html, /<title>([^<]+)\|/i);

  return {
    productId,
    setName: title ? decodeHtmlEntities(title).trim() : null
  };
}

async function fetchOfficialJapaneseProductCards(productId: string) {
  const firstPage = await fetchOfficialJapaneseProductPage(productId, 1);

  if (!firstPage) {
    return [];
  }

  const pages = await Promise.all(
    Array.from({ length: Math.max(0, (firstPage.maxPage ?? 1) - 1) }, (_, index) =>
      fetchOfficialJapaneseProductPage(productId, index + 2)
    )
  );

  return [firstPage, ...pages]
    .flatMap((page) => page?.cardList ?? [])
    .filter((card) => Boolean(card.cardID));
}

async function fetchOfficialJapaneseProductPage(productId: string, page: number) {
  const params = new URLSearchParams({
    pg: productId,
    regulation: "all",
    regulation_sidebar_form: "all",
    page: String(page)
  });
  const response = await fetch(`${pokemonCardJpBaseUrl}/card-search/resultAPI.php?${params}`);

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as OfficialJapaneseSearchResponse;

  return payload.result === 1 ? payload : null;
}

async function fetchOfficialJapaneseCardDetail(
  cardId: string,
  fallbackSetCode: string,
  fallbackSetName: string | null
): Promise<OfficialJapaneseCardDetail | null> {
  const response = await fetch(
    `${pokemonCardJpBaseUrl}/card-search/details.php/card/${encodeURIComponent(cardId)}`
  );

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const detail = await parseOfficialJapaneseCardDetail(
    html,
    cardId,
    fallbackSetCode,
    fallbackSetName
  );

  return detail;
}

async function fetchLimitlessJapaneseCard(
  parsed: ParsedCardQuery
): Promise<OfficialJapaneseCardDetail | null> {
  if (!parsed.setCode || !parsed.printedNumber) {
    return null;
  }

  const response = await fetch(
    `${limitlessBaseUrl}/cards/jp/${encodeURIComponent(parsed.setCode)}/${encodeURIComponent(
      parsed.printedNumber
    )}?translate=en`
  );

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const name = decodeHtmlEntities(
    matchFirst(html, /<span class="card-text-name"><a[^>]*>([^<]+)<\/a><\/span>/i) ??
      matchFirst(html, /<title>([^-<]+)-/i)
  );
  const setName = decodeHtmlEntities(
    matchFirst(html, /<span class="text-lg">\s*([^<]+?)\s*<\/span>/i)
  );
  const rarity =
    decodeHtmlEntities(matchFirst(html, /#\d+\s*·\s*([^<]+?)\s*<\/span>/i)) || null;
  const imageUrl = matchFirst(html, /<img class="card shadow resp-w" src="([^"]+)"/i);

  if (!name) {
    return null;
  }

  return {
    sourceId: `${parsed.setCode}:${parsed.printedNumber}`,
    setCode: parsed.setCode.toLowerCase(),
    setName: setName || null,
    cardNumber: parsed.setTotal
      ? `${parsed.printedNumber}/${parsed.setTotal}`
      : parsed.printedNumber,
    printedNumber: parsed.printedNumber,
    printedTotal: parsed.setTotal,
    name,
    japaneseName: name,
    rarity,
    imageUrl,
    rawPayload: JSON.stringify({
      source: `${limitlessBaseUrl}/cards/jp/${parsed.setCode}/${parsed.printedNumber}?translate=en`
    })
  };
}

async function parseOfficialJapaneseCardDetail(
  html: string,
  cardId: string,
  fallbackSetCode: string,
  fallbackSetName: string | null
): Promise<OfficialJapaneseCardDetail | null> {
  const japaneseName = decodeHtmlEntities(
    matchFirst(html, /<h1[^>]*class="[^"]*Heading1[^"]*"[^>]*>([^<]+)/i)
  );
  const setCode = decodeHtmlEntities(
    matchFirst(html, /class="img-regulation"[^>]*alt="([^"]+)"/i) || fallbackSetCode
  );
  const numberMatch = html.match(
    /class="img-regulation"[^>]*alt="[^"]+"[^>]*>\s*(?:&nbsp;|\s)*([a-z0-9]+)\s*(?:&nbsp;|\s)*\/\s*(?:&nbsp;|\s)*([a-z0-9]+)/i
  );

  if (!japaneseName || !setCode || !numberMatch) {
    return null;
  }

  const printedNumber = numberMatch[1];
  const printedTotal = numberMatch[2] ?? null;
  const imagePath = matchFirst(html, /<img[^>]*class="fit"[^>]*src="([^"]+)"/i);
  const dexId =
    matchFirst(html, /####\s*No\.(\d+)/i) ??
    matchFirst(html, /<h4>\s*No\.(\d+)/i);
  const englishName = dexId ? await fetchEnglishPokemonSpeciesName(dexId) : null;
  const setName =
    decodeHtmlEntities(matchFirst(html, /<li class="List_item"><a[^>]*>([^<]+)<\/a>/i)) ||
    fallbackSetName;
  const rarity =
    matchFirst(html, /\/rarity\/ic_rare_([a-z0-9_]+)\.gif/i)
      ?.replace(/_/g, " ")
      .toUpperCase() ?? null;

  return {
    sourceId: cardId,
    setCode: setCode.toLowerCase(),
    setName,
    cardNumber: printedTotal ? `${printedNumber}/${printedTotal}` : printedNumber,
    printedNumber,
    printedTotal,
    name: translateJapaneseCardName(japaneseName, englishName),
    japaneseName,
    rarity,
    imageUrl: imagePath ? absolutePokemonCardJpUrl(imagePath) : null,
    rawPayload: JSON.stringify({
      cardId,
      dexId,
      japaneseName,
      englishName,
      source: `${pokemonCardJpBaseUrl}/card-search/details.php/card/${cardId}`
    })
  };
}

function upsertJapaneseCacheDetails(
  database: AppDatabase,
  details: OfficialJapaneseCardDetail[],
  source = "pokemon-card-jp"
) {
  const statement = database.connection.prepare(
    `
      INSERT INTO japanese_card_cache (
        id,
        source,
        source_id,
        set_code,
        set_name,
        card_number,
        printed_number,
        printed_total,
        name,
        rarity,
        image_url,
        raw_payload
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET
        set_code = excluded.set_code,
        set_name = excluded.set_name,
        card_number = excluded.card_number,
        printed_number = excluded.printed_number,
        printed_total = excluded.printed_total,
        name = excluded.name,
        rarity = excluded.rarity,
        image_url = excluded.image_url,
        raw_payload = excluded.raw_payload,
        updated_at = CURRENT_TIMESTAMP
    `
  );

  const existing = database.connection.prepare(
    "SELECT id FROM japanese_card_cache WHERE source = ? AND source_id = ?"
  );

  for (const detail of details) {
    const existingRow = existing.get(source, detail.sourceId) as { id: string } | undefined;

    statement.run(
      existingRow?.id ?? randomUUID(),
      source,
      detail.sourceId,
      detail.setCode,
      detail.setName,
      detail.cardNumber,
      detail.printedNumber,
      detail.printedTotal,
      detail.name,
      detail.rarity,
      detail.imageUrl,
      detail.rawPayload
    );
  }
}

function lookupJapaneseCacheCards(
  database: AppDatabase,
  parsed: ParsedCardQuery,
  query: string
): CardLookupCandidate[] {
  const rows = selectJapaneseCacheRows(database, parsed, query);

  return rows.map((row) => mapJapaneseCacheRow(row, parsed));
}

function selectJapaneseCacheRows(
  database: AppDatabase,
  parsed: ParsedCardQuery,
  query: string
) {
  if (parsed.kind === "set-number" && parsed.setCode && parsed.printedNumber) {
    const [printedNumber, localId] = cardNumberSearchValues(parsed);

    return database.connection
      .prepare(
        `
          SELECT *
          FROM japanese_card_cache
          WHERE set_code = ? AND printed_number IN (?, ?)
          ORDER BY updated_at DESC
          LIMIT 12
        `
      )
      .all(parsed.setCode, printedNumber, localId) as JapaneseCacheRow[];
  }

  if (parsed.kind === "number" && parsed.printedNumber && parsed.setTotal) {
    const [printedNumber, localId] = cardNumberSearchValues(parsed);

    return database.connection
      .prepare(
        `
          SELECT *
          FROM japanese_card_cache
          WHERE printed_number IN (?, ?) AND printed_total = ?
          ORDER BY updated_at DESC
          LIMIT 12
        `
      )
      .all(printedNumber, localId, parsed.setTotal) as JapaneseCacheRow[];
  }

  if (parsed.kind === "name" && query.length >= 2) {
    return database.connection
      .prepare(
        `
          SELECT *
          FROM japanese_card_cache
          WHERE name LIKE ?
          ORDER BY updated_at DESC
          LIMIT 12
        `
      )
      .all(`%${query}%`) as JapaneseCacheRow[];
  }

  return [];
}

function mapJapaneseCacheRow(
  row: JapaneseCacheRow,
  parsed: ParsedCardQuery
): CardLookupCandidate {
  const name = translateJapaneseCardName(row.name, null);
  const item = buildInventoryItem({
    name,
    setName: row.set_name,
    setCode: row.set_code,
    cardNumber: row.card_number,
    language: "ja",
    rarity: row.rarity,
    imageUrl: row.image_url,
    sourceLabel: `Japanese cache: ${row.source} ${row.source_id}`
  });

  return {
    id: `jp-cache:${row.id}`,
    source: "japanese-cache",
    sourceId: row.source_id,
    confidence: confidenceForCard(row.set_code, row.printed_number, parsed, row.printed_total),
    name,
    setName: row.set_name,
    setCode: row.set_code,
    cardNumber: row.card_number,
    language: "ja",
    rarity: row.rarity,
    imageUrl: row.image_url,
    item,
    score: scoreGenericCard(row.set_code, row.printed_number, parsed, row.printed_total)
  };
}

function buildInventoryItem(input: {
  name: string;
  setName: string | null;
  setCode: string | null;
  cardNumber: string | null;
  language: CardLanguage;
  rarity: string | null;
  imageUrl: string | null;
  releaseYear?: string | null;
  sourceLabel: string;
}): CreateInventoryItemRequest {
  return {
    name: input.name,
    setName: input.setName ?? undefined,
    setCode: input.setCode ?? undefined,
    cardNumber: input.cardNumber ?? undefined,
    language: input.language,
    rarity: input.rarity ?? undefined,
    releaseYear: input.releaseYear ?? undefined,
    imageUrl: input.imageUrl ?? undefined,
    itemType: "raw",
    quantity: 1,
    notes: input.sourceLabel
  };
}

function releaseYearFromDate(value: string | null | undefined) {
  const match = String(value ?? "").match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  return match?.[1] ?? null;
}

function dedupeCandidates(candidates: CardLookupCandidate[]) {
  const seen = new Set<string>();
  const confidenceRank = { exact: 0, strong: 1, possible: 2 };

  return candidates
    .filter((candidate) => {
      const key = [
        normalizeCandidateName(candidate.name),
        candidate.language,
        candidate.setCode?.toLowerCase(),
        normalizeCandidateCardNumber(candidate.cardNumber)
      ].join("|");

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const confidenceDelta = confidenceRank[left.confidence] - confidenceRank[right.confidence];

      if (confidenceDelta !== 0) {
        return confidenceDelta;
      }

      const scoreDelta = right.score - left.score;

      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return sourceRank(left.source) - sourceRank(right.source);
    });
}

function sourceRank(source: CardLookupCandidate["source"]) {
  if (source === "japanese-cache") {
    return 0;
  }

  return source === "pokemontcg" ? 1 : source === "tcgdex" ? 2 : 3;
}

function buildParsedFallbackCandidate(parsed: ParsedCardQuery): CardLookupCandidate[] {
  if (parsed.kind !== "set-number" || !parsed.setCode || !parsed.cardNumber) {
    return [];
  }

  const name = `${parsed.setCode.toUpperCase()} ${parsed.cardNumber}`;
  const item = buildInventoryItem({
    name,
    setName: null,
    setCode: parsed.setCode,
    cardNumber: parsed.cardNumber,
    language: "ja",
    rarity: null,
    imageUrl: null,
    sourceLabel: "Parsed from set/card number; verify card details."
  });

  return [
    {
      id: `parsed:${parsed.setCode}:${parsed.cardNumber}`,
      source: "parsed",
      sourceId: `${parsed.setCode} ${parsed.cardNumber}`,
      confidence: "possible",
      name,
      setName: null,
      setCode: parsed.setCode,
      cardNumber: parsed.cardNumber,
      language: "ja",
      rarity: null,
      imageUrl: null,
      item,
      score: 0
    }
  ];
}

function scoreGenericCard(
  setCode: string | undefined,
  cardNumber: string | undefined,
  parsed: ParsedCardQuery,
  printedTotal?: number | string | null
) {
  const normalizedSetCode = setCode?.toLowerCase();
  const normalizedCardNumber = cardNumber?.toLowerCase();
  const parsedSetCode = parsed.setCode?.toLowerCase();
  const parsedCardNumber = parsed.cardNumber?.toLowerCase();
  const parsedPrintedNumber = parsed.printedNumber?.toLowerCase();
  const parsedLocalId = parsed.localId?.toLowerCase();
  const normalizedPrintedTotal = printedTotal ? String(printedTotal).toLowerCase() : null;
  const parsedSetTotal = parsed.setTotal?.toLowerCase() ?? null;
  let score = 0;

  if (numberMatches(normalizedCardNumber, parsedCardNumber, parsedPrintedNumber, parsedLocalId)) {
    score += 50;
  }

  if (parsedSetTotal && normalizedPrintedTotal === parsedSetTotal) {
    score += 100;
  }

  if (parsedSetCode && normalizedSetCode === parsedSetCode) {
    score += 150;
  }

  if (parsed.kind === "name") {
    score += 10;
  }

  return score;
}

function confidenceForCard(
  setCode: string | undefined,
  cardNumber: string | undefined,
  parsed: ParsedCardQuery,
  printedTotal?: number | string | null
): CardLookupCandidate["confidence"] {
  const normalizedSetCode = setCode?.toLowerCase();
  const normalizedCardNumber = cardNumber?.toLowerCase();
  const parsedSetCode = parsed.setCode?.toLowerCase();
  const parsedCardNumber = parsed.cardNumber?.toLowerCase();
  const parsedPrintedNumber = parsed.printedNumber?.toLowerCase();
  const parsedLocalId = parsed.localId?.toLowerCase();
  const normalizedPrintedTotal = printedTotal ? String(printedTotal).toLowerCase() : null;
  const parsedSetTotal = parsed.setTotal?.toLowerCase() ?? null;

  if (
    parsed.kind === "set-number" &&
    normalizedSetCode === parsedSetCode &&
    numberMatches(normalizedCardNumber, parsedCardNumber, parsedPrintedNumber, parsedLocalId)
  ) {
    return "exact";
  }

  if (
    parsed.kind === "number" &&
    numberMatches(normalizedCardNumber, parsedCardNumber, parsedPrintedNumber, parsedLocalId)
  ) {
    return parsedSetTotal && normalizedPrintedTotal === parsedSetTotal ? "exact" : "strong";
  }

  return parsed.kind === "name" ? "possible" : "possible";
}

function splitCardNumber(cardNumber: string) {
  const [printedNumber, setTotal] = cardNumber.split("/");
  const normalizedPrintedNumber = normalizeLeadingZeroCardNumber(printedNumber);

  return {
    printedNumber: normalizedPrintedNumber,
    setTotal: setTotal ?? null,
    localId: printedNumber.padStart(3, "0")
  };
}

function normalizeLeadingZeroCardNumber(value: string) {
  return /^\d+$/.test(value) ? String(Number(value)) : value;
}

function cardNumberSearchValues(parsed: ParsedCardQuery) {
  const printedNumber = parsed.printedNumber ?? "";
  const localId = parsed.localId ?? printedNumber;

  return [printedNumber, localId] as const;
}

function numberMatches(
  cardNumber: string | undefined,
  parsedCardNumber: string | undefined,
  parsedPrintedNumber: string | undefined,
  parsedLocalId: string | undefined
) {
  return (
    cardNumber === parsedCardNumber ||
    cardNumber === parsedPrintedNumber ||
    cardNumber === parsedLocalId
  );
}

function normalizeCandidateName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeCandidateCardNumber(value: string | null | undefined) {
  const cardNumber = value?.split("/")[0]?.toLowerCase() ?? "";

  return normalizeLeadingZeroCardNumber(cardNumber);
}

function displayCardNumber(cardNumber: string | undefined, printedTotal: number | undefined) {
  return cardNumber && printedTotal ? `${cardNumber}/${printedTotal}` : cardNumber;
}

function matchFirst(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1] ?? null;
}

function decodeHtmlEntities(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function absolutePokemonCardJpUrl(path: string) {
  return path.startsWith("http") ? path : `${pokemonCardJpBaseUrl}${path}`;
}

async function fetchEnglishPokemonSpeciesName(dexId: string) {
  const response = await fetch(`${pokeApiBaseUrl}/pokemon-species/${encodeURIComponent(dexId)}`);

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as PokeApiSpeciesResponse;
  const englishName = payload.names?.find((name) => name.language?.name === "en")?.name;

  return englishName ?? null;
}

function translateCardName(name: string, language: CardLanguage) {
  return language === "ja" ? translateJapaneseCardName(name, null) : name;
}

function translateJapaneseCardName(japaneseName: string, dexEnglishName: string | null) {
  const translatedName = japanesePokemonNameMap.reduce(
    (name, [japanese, english]) => name.replaceAll(japanese, english),
    japaneseName
  );

  if (translatedName !== japaneseName) {
    return normalizeTranslatedCardName(translatedName);
  }

  if (!dexEnglishName) {
    return japaneseName;
  }

  return normalizeTranslatedCardName(applyCardNameSuffix(japaneseName, dexEnglishName));
}

function applyCardNameSuffix(japaneseName: string, englishName: string) {
  const suffix = japaneseName.match(/[A-Za-z][A-Za-z0-9-]*$/)?.[0];

  return suffix && !englishName.toLowerCase().endsWith(suffix.toLowerCase())
    ? `${englishName} ${suffix}`
    : englishName;
}

function normalizeTranslatedCardName(name: string) {
  return name
    .replace(/＆/g, "&")
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s*・\s*/g, " / ")
    .replace(/^M(?=[A-Z])/, "M ")
    .replace(/([A-Za-z])\s*(V-UNION|VSTAR|VMAX|BREAK|GX|EX|ex|V)$/u, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function mapWithConcurrency<Input, Output>(
  items: Input[],
  limit: number,
  mapper: (item: Input) => Promise<Output>
) {
  const results: Output[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );

  return results;
}

function escapePokemonTcgTerm(value: string) {
  return value.replace(/["\\]/g, "");
}

function pokemonTcgNameTerms(query: string) {
  return query
    .split(/[^a-z0-9]+/i)
    .map((term) => escapePokemonTcgTerm(term.trim().toLowerCase()))
    .filter(Boolean);
}
