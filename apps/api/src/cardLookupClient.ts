import type {
  CardLanguage,
  CardLookupCandidate,
  CardLookupResponse,
  CreateInventoryItemRequest
} from "@collection-tool/shared";

type CardLookupOptions = {
  query: string;
  language: CardLanguage | "all";
  pokemonTcgApiKey: string;
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
  };
};

const pokemonTcgBaseUrl = "https://api.pokemontcg.io/v2";
const tcgdexBaseUrl = "https://api.tcgdex.net/v2";

export async function lookupCards({
  query,
  language,
  pokemonTcgApiKey
}: CardLookupOptions): Promise<CardLookupResponse> {
  const normalizedQuery = query.trim();
  const parsed = parseCardQuery(normalizedQuery);
  const lookupTasks: Array<Promise<CardLookupCandidate[]>> = [];

  if (language === "all" || language === "en") {
    lookupTasks.push(lookupPokemonTcgCards(parsed, normalizedQuery, pokemonTcgApiKey));
    lookupTasks.push(lookupTcgdexCards("en", parsed, normalizedQuery));
  }

  if (language === "all" || language === "ja") {
    lookupTasks.push(lookupTcgdexCards("ja", parsed, normalizedQuery));
  }

  const settled = await Promise.allSettled(lookupTasks);
  const candidates = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
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
    /^([a-z0-9][a-z0-9-]{1,18})[\s#-]+([a-z0-9]+(?:\/[a-z0-9]+)?)$/i
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
    const direct = await fetchTcgdexCard(language, parsed.setCode, parsed.localId);
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
    return `name:${escapePokemonTcgTerm(query)}*`;
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
  const item = buildInventoryItem({
    name: card.name ?? "Unknown card",
    setName: card.set?.name ?? null,
    setCode: card.set?.id ?? null,
    cardNumber: card.localId ?? null,
    language,
    rarity: card.rarity ?? null,
    imageUrl,
    sourceLabel: `TCGdex ID: ${sourceId}`
  });

  return {
    id: `tcgdex:${language}:${sourceId}`,
    source: "tcgdex",
    sourceId,
    confidence: confidenceForCard(card.set?.id, card.localId, parsed),
    name: card.name ?? "Unknown card",
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

function buildInventoryItem(input: {
  name: string;
  setName: string | null;
  setCode: string | null;
  cardNumber: string | null;
  language: CardLanguage;
  rarity: string | null;
  imageUrl: string | null;
  sourceLabel: string;
}): CreateInventoryItemRequest {
  return {
    name: input.name,
    setName: input.setName ?? undefined,
    setCode: input.setCode ?? undefined,
    cardNumber: input.cardNumber ?? undefined,
    language: input.language,
    rarity: input.rarity ?? undefined,
    imageUrl: input.imageUrl ?? undefined,
    itemType: "raw",
    quantity: 1,
    notes: input.sourceLabel
  };
}

function dedupeCandidates(candidates: CardLookupCandidate[]) {
  const seen = new Set<string>();
  const confidenceRank = { exact: 0, strong: 1, possible: 2 };

  return candidates
    .filter((candidate) => {
      const key = [
        candidate.name.toLowerCase(),
        candidate.language,
        candidate.setCode?.toLowerCase(),
        candidate.cardNumber?.toLowerCase()
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
  return source === "pokemontcg" ? 0 : source === "tcgdex" ? 1 : 2;
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
  printedTotal?: number
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
  printedTotal?: number
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

  return {
    printedNumber,
    setTotal: setTotal ?? null,
    localId: printedNumber.padStart(3, "0")
  };
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

function displayCardNumber(cardNumber: string | undefined, printedTotal: number | undefined) {
  return cardNumber && printedTotal ? `${cardNumber}/${printedTotal}` : cardNumber;
}

function escapePokemonTcgTerm(value: string) {
  return value.replace(/["\\]/g, "");
}
