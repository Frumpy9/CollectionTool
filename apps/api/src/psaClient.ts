import type { CreateInventoryItemRequest, PsaCertLookupResponse } from "@collection-tool/shared";

const psaBaseUrl = "https://api.psacard.com/publicapi";
const psaSubjectAliases: Record<string, string> = {
  artcn: "articuno",
  mltrs: "moltres",
  zpds: "zapdos"
};
const limitlessBaseUrl = "https://limitlesstcg.com";
const pokemonPriceTrackerBaseUrl = "https://www.pokemonpricetracker.com/api/v2";
const japanesePsaSetCodes: Array<{ token: string; setCode: string }> = [
  { token: "shiny star v", setCode: "S4a" }
];
const psaPokemonPriceTrackerCards: Record<string, string> = {
  "2173840": "575806"
};

type PsaLookupOptions = {
  accessToken: string;
  pokemonTcgApiKey: string;
  pokemonPriceTrackerApiKey: string;
  certNumber: string;
};

type PokemonTcgCard = {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set?: {
    name?: string;
    series?: string;
  };
  images?: {
    small?: string;
    large?: string;
  };
};

export async function lookupPsaCert({
  accessToken,
  pokemonTcgApiKey,
  pokemonPriceTrackerApiKey,
  certNumber
}: PsaLookupOptions): Promise<PsaCertLookupResponse> {
  if (!accessToken) {
    throw new Error("PSA_ACCESS_TOKEN is not configured.");
  }

  const response = await fetch(
    `${psaBaseUrl}/cert/GetByCertNumber/${encodeURIComponent(certNumber)}`,
    {
      headers: {
        authorization: `bearer ${accessToken}`,
        accept: "application/json"
      }
    }
  );

  if (response.status === 204) {
    return emptyLookup(certNumber, "No data returned for that cert number.");
  }

  if (!response.ok) {
    throw new Error(`PSA lookup failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  const normalized = normalizePsaResponse(certNumber, payload);

  if (!normalized.item?.cardNumber) {
    return normalized;
  }

  const pokemonCard = await lookupPokemonTcgCard(
    normalized.item.cardNumber,
    {
      brand: normalized.source.brand,
      subject: normalized.source.subject
    },
    pokemonTcgApiKey
  ).catch(() => null);

  if (pokemonCard) {
    return {
      ...normalized,
      item: {
        ...normalized.item,
        name: pokemonCard.name,
        setName: pokemonCard.set?.name ?? normalized.item.setName,
        rarity: pokemonCard.rarity ?? normalized.item.rarity,
        imageUrl: pokemonCard.images?.large ?? pokemonCard.images?.small ?? normalized.item.imageUrl,
        notes: [
          normalized.item.notes,
          `PokemonTCG.io ID: ${pokemonCard.id}`
        ]
          .filter(Boolean)
          .join("\n")
      }
    };
  }

  const japaneseCard = await lookupLimitlessJapanesePsaCard(normalized.item.cardNumber, {
    brand: normalized.source.brand,
    variety: normalized.source.variety
  }).catch(() => null);

  if (japaneseCard) {
    return {
      ...normalized,
      item: {
        ...normalized.item,
        name: japaneseCard.name,
        setName: japaneseCard.setName ?? normalized.item.setName,
        rarity: japaneseCard.rarity ?? normalized.item.rarity,
        imageUrl: japaneseCard.imageUrl ?? normalized.item.imageUrl,
        notes: [
          normalized.item.notes,
          `Limitless JP: ${japaneseCard.setCode} ${japaneseCard.cardNumber}`
        ]
          .filter(Boolean)
          .join("\n")
      }
    };
  }

  const priceTrackerCard = await lookupPokemonPriceTrackerPsaCard(
    {
      apiKey: pokemonPriceTrackerApiKey,
      cardNumber: normalized.item.cardNumber,
      brand: normalized.source.brand,
      specId: normalized.source.specId,
      subject: normalized.source.subject,
      variety: normalized.source.variety
    }
  ).catch(() => null);

  if (priceTrackerCard) {
    return {
      ...normalized,
      item: {
        ...normalized.item,
        name: priceTrackerCard.name ?? normalized.item.name,
        setName: priceTrackerCard.setName ?? normalized.item.setName,
        cardNumber: priceTrackerCard.cardNumber ?? normalized.item.cardNumber,
        rarity: priceTrackerCard.rarity ?? normalized.item.rarity,
        imageUrl: priceTrackerCard.imageUrl ?? normalized.item.imageUrl,
        notes: [
          normalized.item.notes,
          `PokemonPriceTracker: ${priceTrackerCard.setName ?? "matched card"}`
        ]
          .filter(Boolean)
          .join("\n")
      }
    };
  }

  return normalized;
}

type LimitlessJapanesePsaCard = {
  setCode: string;
  setName: string | null;
  cardNumber: string;
  name: string;
  rarity: string | null;
  imageUrl: string | null;
};

type PokemonPriceTrackerPsaCard = {
  name: string | null;
  setName: string | null;
  cardNumber: string | null;
  rarity: string | null;
  imageUrl: string | null;
};

function normalizePsaResponse(certNumber: string, payload: unknown): PsaCertLookupResponse {
  const hasCertPayload = Boolean(findValue(payload, ["PSACert"]));
  const isValidRequest =
    hasCertPayload || Boolean(findValue(payload, ["IsValidRequest", "isValidRequest"]));
  const serverMessage =
    stringify(findValue(payload, ["ServerMessage", "serverMessage"])) ??
    (hasCertPayload ? "Request successful" : "Unknown PSA response.");

  if (
    !isValidRequest ||
    (!hasCertPayload && !serverMessage.toLowerCase().includes("successful"))
  ) {
    return {
      ...emptyLookup(certNumber, serverMessage),
      isValidRequest
    };
  }

  const cardNumber = stringify(findValue(payload, ["CardNumber", "cardNumber", "CardNo"]));
  const grade = stringify(
    findValue(payload, ["CardGrade", "Grade", "cardGrade", "grade", "GradeDescription"])
  );
  const year = stringify(findValue(payload, ["Year", "year"]));
  const brand = stringify(findValue(payload, ["Brand", "brand", "SetName", "setName"]));
  const subject = stringify(
    findValue(payload, ["Subject", "Player", "Name", "CardName", "Description"])
  );
  const variety = stringify(findValue(payload, ["Variety", "variety"]));
  const category = stringify(findValue(payload, ["Category", "category"]));
  const specId = stringify(findValue(payload, ["SpecID", "SpecId", "specID", "specId"]));
  const population = stringify(
    findValue(payload, ["Population", "TotalPopulation", "totalPopulation"])
  );
  const populationHigher = stringify(findValue(payload, ["PopHigher", "PopulationHigher"]));
  const estimateCents = moneyToCents(
    findValue(payload, [
      "PsaEstimate",
      "PSAEstimate",
      "psaEstimate",
      "EstimatedValue",
      "estimatedValue",
      "ValueEstimate",
      "valueEstimate",
      "SMRPrice",
      "smrPrice"
    ])
  );
  const imageUrl = stringify(findValue(payload, ["ImageURL", "ImageUrl", "imageUrl", "Image"]));
  const certFromPayload =
    stringify(findValue(payload, ["CertNumber", "CertNo", "certNumber", "certNo"])) ?? certNumber;
  const certUrl = `https://www.psacard.com/cert/${encodeURIComponent(certFromPayload)}/psa`;
  const name = displayPsaSubject(subject) ?? buildCardName({ year, brand, subject, variety });

  const item: CreateInventoryItemRequest = {
    name: name || `PSA Cert ${certFromPayload}`,
    setName: brand ?? undefined,
    cardNumber: cardNumber ?? undefined,
    language: isJapanesePsaLabel(brand, variety) ? "ja" : "en",
    releaseYear: year ?? undefined,
    imageUrl: imageUrl ?? undefined,
    itemType: "graded",
    quantity: 1,
    grader: "PSA",
    grade: grade ?? undefined,
    certNumber: certFromPayload,
    variantDetails: variety ?? undefined,
    notes: specId ? `PSA Spec ID: ${specId}` : undefined,
    certUrl,
    certSpecId: specId ?? undefined,
    certCategory: category ?? undefined,
    certPopulation: population ?? undefined,
    certPopulationHigher: populationHigher ?? undefined,
    certEstimateCents: estimateCents ?? undefined,
    certLookupAt: new Date().toISOString()
  };

  return {
    certNumber: certFromPayload,
    isValidRequest,
    serverMessage,
    item,
    source: {
      specId: specId ?? null,
      year: year ?? null,
      brand: brand ?? null,
      subject: subject ?? null,
      variety: variety ?? null,
      category: category ?? null,
      population: population ?? null,
      populationHigher: populationHigher ?? null,
      estimateCents: estimateCents ?? null
    }
  };
}

function emptyLookup(certNumber: string, serverMessage: string): PsaCertLookupResponse {
  return {
    certNumber,
    isValidRequest: false,
    serverMessage,
    item: null,
    source: {
      specId: null,
      year: null,
      brand: null,
      subject: null,
      variety: null,
      category: null,
      population: null,
      populationHigher: null,
      estimateCents: null
    }
  };
}

function buildCardName(parts: {
  year?: string | null;
  brand?: string | null;
  subject?: string | null;
  variety?: string | null;
}) {
  return [parts.year, parts.brand, parts.subject, parts.variety].filter(Boolean).join(" ");
}

function displayPsaSubject(subject: string | null) {
  const normalized = subject
    ?.replace(/\bFA\s*\/\s*/gi, "")
    .replace(/\bFULL\s+ART\s*\/\s*/gi, "")
    .replace(/\bMLTRS\b/gi, "Moltres")
    .replace(/\bZPDS\b/gi, "Zapdos")
    .replace(/\bARTCN\b/gi, "Articuno")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  return normalized
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .replace(/\bVmax\b/g, "VMAX")
    .replace(/\bVstar\b/g, "VSTAR")
    .replace(/\bEx\b/g, "EX")
    .replace(/\bGx\b/g, "GX");
}

function isJapanesePsaLabel(...values: Array<string | null>) {
  return values.some((value) => value?.toLowerCase().includes("japanese"));
}

async function lookupLimitlessJapanesePsaCard(
  cardNumber: string | undefined,
  psaContext: { brand: string | null; variety: string | null }
): Promise<LimitlessJapanesePsaCard | null> {
  if (!cardNumber || !isJapanesePsaLabel(psaContext.brand, psaContext.variety)) {
    return null;
  }

  const setCode = japanesePsaSetCode(psaContext.brand, psaContext.variety);

  if (!setCode) {
    return null;
  }

  const response = await fetch(
    `${limitlessBaseUrl}/cards/jp/${encodeURIComponent(setCode)}/${encodeURIComponent(
      cardNumber
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
    setCode,
    setName: setName || null,
    cardNumber,
    name,
    rarity,
    imageUrl
  };
}

async function lookupPokemonPriceTrackerPsaCard({
  apiKey,
  cardNumber,
  brand,
  specId,
  subject,
  variety
}: {
  apiKey: string;
  cardNumber: string | undefined;
  brand: string | null;
  specId: string | null;
  subject: string | null;
  variety: string | null;
}): Promise<PokemonPriceTrackerPsaCard | null> {
  if (!apiKey || !subject) {
    return null;
  }

  const cardName = displayPsaSubject(subject) ?? subject;
  const knownTcgPlayerId = specId ? psaPokemonPriceTrackerCards[specId] : null;

  if (knownTcgPlayerId) {
    const card = await fetchPokemonPriceTrackerCardByTcgPlayerId({
      apiKey,
      tcgPlayerId: knownTcgPlayerId,
      japanese: isJapanesePsaLabel(brand, variety)
    });

    if (card && pokemonPriceTrackerCardMatchesPsa(card, { cardName, cardNumber })) {
      return pokemonPriceTrackerPsaCardFromPayload(card);
    }
  }

  const queries = pokemonPriceTrackerPsaQueries({ cardName, cardNumber, brand, variety });

  for (const query of queries) {
    const url = new URL(`${pokemonPriceTrackerBaseUrl}/cards`);
    url.searchParams.set("search", query);
    url.searchParams.set("limit", "5");

    if (isJapanesePsaLabel(brand, variety)) {
      url.searchParams.set("language", "japanese");
    }

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      continue;
    }

    const payload = await response.json().catch(() => ({}));
    const cards = pokemonPriceTrackerCardsFromResponse(payload);
    const bestCard = cards
      .filter((card) => pokemonPriceTrackerCardMatchesPsa(card, { cardName, cardNumber }))
      .sort(
        (left, right) =>
          pokemonPriceTrackerPsaScore(right, { cardName, cardNumber }) -
          pokemonPriceTrackerPsaScore(left, { cardName, cardNumber })
      )[0];

    if (bestCard) {
      return pokemonPriceTrackerPsaCardFromPayload(bestCard);
    }
  }

  return null;
}

async function fetchPokemonPriceTrackerCardByTcgPlayerId({
  apiKey,
  tcgPlayerId,
  japanese
}: {
  apiKey: string;
  tcgPlayerId: string;
  japanese: boolean;
}) {
  const url = new URL(`${pokemonPriceTrackerBaseUrl}/cards`);
  url.searchParams.set("tcgPlayerId", tcgPlayerId);
  url.searchParams.set("limit", "1");

  if (japanese) {
    url.searchParams.set("language", "japanese");
  }

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  return pokemonPriceTrackerCardsFromResponse(payload)[0] ?? null;
}

function pokemonPriceTrackerPsaCardFromPayload(
  card: PokemonPriceTrackerCardPayload
): PokemonPriceTrackerPsaCard {
  return {
    name: stringify(card.name),
    setName: stringify(card.setName ?? card.set),
    cardNumber: stringify(card.cardNumber ?? card.number),
    rarity: stringify(card.rarity),
    imageUrl: pokemonPriceTrackerImageUrl(card)
  };
}

function pokemonPriceTrackerPsaQueries({
  cardName,
  cardNumber,
  brand,
  variety
}: {
  cardName: string;
  cardNumber: string | undefined;
  brand: string | null;
  variety: string | null;
}) {
  const queries = [
    [cardName, brand, variety, cardNumber].filter(Boolean).join(" "),
    [cardName, brand, variety].filter(Boolean).join(" "),
    [cardName, cardNumber].filter(Boolean).join(" "),
    cardName
  ];
  const normalizedLabel = normalizeText([brand, variety].filter(Boolean).join(" "));

  if (normalizedLabel.includes("pokemon japanese neo")) {
    queries.unshift([cardName, "Gold Silver to a New World"].filter(Boolean).join(" "));
  }

  return queries.filter(
    (query, index, allQueries) =>
      query && allQueries.findIndex((candidate) => normalizeText(candidate) === normalizeText(query)) === index
  );
}

type PokemonPriceTrackerCardPayload = {
  name?: unknown;
  setName?: unknown;
  set?: unknown;
  cardNumber?: unknown;
  number?: unknown;
  rarity?: unknown;
  imageUrl?: unknown;
  imageCdnUrl?: unknown;
  imageCdnUrl200?: unknown;
  imageCdnUrl400?: unknown;
  imageCdnUrl800?: unknown;
  image?: unknown;
  images?: {
    small?: unknown;
    large?: unknown;
  };
};

function pokemonPriceTrackerCardsFromResponse(payload: unknown): PokemonPriceTrackerCardPayload[] {
  return normalizePokemonPriceTrackerCards([
    isRecord(payload) ? payload.data : null,
    isRecord(payload) ? payload.card : null,
    isRecord(payload) ? payload.matches : null
  ]);
}

function normalizePokemonPriceTrackerCards(values: unknown[]): PokemonPriceTrackerCardPayload[] {
  const cards: PokemonPriceTrackerCardPayload[] = [];

  for (const value of values) {
    if (Array.isArray(value)) {
      cards.push(...normalizePokemonPriceTrackerCards(value));
      continue;
    }

    if (isRecord(value)) {
      if (isRecord(value.card)) {
        cards.push(value.card as PokemonPriceTrackerCardPayload);
      } else if (value.name || value.setName || value.cardNumber || value.imageUrl) {
        cards.push(value as PokemonPriceTrackerCardPayload);
      }
    }
  }

  return cards;
}

function pokemonPriceTrackerCardMatchesPsa(
  card: PokemonPriceTrackerCardPayload,
  psaCard: { cardName: string; cardNumber: string | undefined }
) {
  return pokemonPriceTrackerPsaScore(card, psaCard) >= 5;
}

function pokemonPriceTrackerPsaScore(
  card: PokemonPriceTrackerCardPayload,
  psaCard: { cardName: string; cardNumber: string | undefined }
) {
  let score = 0;
  const cardName = normalizeText(stringify(card.name));
  const expectedName = normalizeText(psaCard.cardName);
  const cardNumber = normalizeCardNumber(stringify(card.cardNumber ?? card.number));
  const expectedNumber = normalizeCardNumber(psaCard.cardNumber);

  if (cardName && expectedName && (cardName === expectedName || cardName.includes(expectedName))) {
    score += 5;
  }

  if (cardNumber && expectedNumber && cardNumber === expectedNumber) {
    score += 4;
  }

  if (pokemonPriceTrackerImageUrl(card)) {
    score += 1;
  }

  return score;
}

function pokemonPriceTrackerImageUrl(card: PokemonPriceTrackerCardPayload) {
  return stringify(
    card.imageCdnUrl800 ??
      card.imageCdnUrl400 ??
      card.imageUrl ??
      card.imageCdnUrl ??
      card.images?.large ??
      card.images?.small ??
      card.image ??
      card.imageCdnUrl200
  );
}

function japanesePsaSetCode(...values: Array<string | null>) {
  const label = values.filter(Boolean).join(" ").toLowerCase();
  const match = japanesePsaSetCodes.find(({ token }) => label.includes(token));

  return match?.setCode ?? null;
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

function normalizeText(value: string | number | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCardNumber(value: string | number | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^0+(?=\d)/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function findValue(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const lowerKeys = new Set(keys.map((key) => key.toLowerCase()));

  for (const [key, nestedValue] of Object.entries(record)) {
    if (lowerKeys.has(key.toLowerCase())) {
      return nestedValue;
    }
  }

  for (const nestedValue of Object.values(record)) {
    if (nestedValue && typeof nestedValue === "object") {
      const found = findValue(nestedValue, keys);

      if (found !== undefined && found !== null && found !== "") {
        return found;
      }
    }
  }

  return undefined;
}

function stringify(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text ? text : null;
}

function moneyToCents(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed =
    typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
}

async function lookupPokemonTcgCard(
  cardNumber: string,
  psaContext: { brand: string | null; subject: string | null },
  apiKey: string
) {
  if (!apiKey) {
    return null;
  }

  const query = encodeURIComponent(`number:${cardNumber}`);
  const response = await fetch(`https://api.pokemontcg.io/v2/cards?q=${query}`, {
    headers: {
      "X-Api-Key": apiKey,
      accept: "application/json"
    }
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { data?: PokemonTcgCard[] };
  return selectBestPokemonTcgCard(payload.data ?? [], psaContext);
}

function selectBestPokemonTcgCard(
  cards: PokemonTcgCard[],
  psaContext: { brand: string | null; subject: string | null }
) {
  let best: { card: PokemonTcgCard; score: number; subjectMatches: number } | null = null;

  for (const card of cards) {
    const scored = scorePokemonTcgCandidate(card, psaContext);

    if (!best || scored.score > best.score) {
      best = { card, ...scored };
    }
  }

  return best && best.score >= 4 && best.subjectMatches > 0 ? best.card : null;
}

function scorePokemonTcgCandidate(
  card: PokemonTcgCard,
  psaContext: { brand: string | null; subject: string | null }
) {
  const brandTokens = tokenize(psaContext.brand);
  const subjectTokens = tokenize(psaContext.subject, {
    ignoreGenericCardTerms: true
  });
  const setTokens = tokenize([card.set?.name, card.set?.series].filter(Boolean).join(" "));
  const nameTokens = tokenize(card.name);

  let score = 0;
  let subjectMatches = 0;

  for (const token of brandTokens) {
    if (setTokens.has(token)) {
      score += token.length >= 4 ? 2 : 1;
    }
  }

  for (const token of subjectTokens) {
    if (nameTokens.has(token)) {
      subjectMatches += 1;
      score += token.length >= 4 ? 3 : 1;
    }
  }

  return { score, subjectMatches };
}

function tokenize(
  value: string | null | undefined,
  options: { ignoreGenericCardTerms?: boolean } = {}
) {
  const ignored = new Set(["pokemon", "tcg", "cards", "card", "the", "and"]);
  const genericCardTerms = new Set([
    "alt",
    "art",
    "ex",
    "fa",
    "full",
    "gx",
    "secret",
    "shiny",
    "star",
    "v",
    "vmax",
    "vstar"
  ]);

  return new Set(
    (value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .map((token) => psaSubjectAliases[token.trim()] ?? token.trim())
      .filter(
        (token) =>
          token.length >= 2 &&
          !ignored.has(token) &&
          (!options.ignoreGenericCardTerms || !genericCardTerms.has(token))
      )
  );
}
