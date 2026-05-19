import type {
  CardLookupCandidate,
  InventoryItem,
  InventoryItemType,
  MarketPriceConfidence,
  PokemonPriceTrackerPricingCandidate,
  PricingHistoryPoint
} from "@collection-tool/shared";

const pokemonPriceTrackerBaseUrl = "https://www.pokemonpricetracker.com/api/v2";

type PokemonPriceTrackerCard = {
  id?: string | number | null;
  tcgPlayerId?: string | number | null;
  tcgPlayerUrl?: string | null;
  setName?: string | null;
  set?: string | null;
  name?: string | null;
  cardNumber?: string | number | null;
  number?: string | number | null;
  totalSetNumber?: string | number | null;
  rarity?: string | null;
  imageUrl?: string | null;
  imageCdnUrl?: string | null;
  imageCdnUrl200?: string | null;
  imageCdnUrl400?: string | null;
  imageCdnUrl800?: string | null;
  image?: string | null;
  images?: {
    small?: string | null;
    large?: string | null;
  } | null;
  prices?: Record<string, unknown> | null;
  priceHistory?: unknown;
  history?: unknown;
  variants?: Record<string, unknown> | null;
  printingsAvailable?: string[] | null;
  externalCatalogId?: string | null;
  ebay?: {
    updatedAt?: string | null;
    lastScrapedDate?: string | null;
    lastEbayCheck?: string | null;
    salesByGrade?: Record<string, PokemonPriceTrackerGradeSummary>;
    totalSales?: number | null;
    totalValue?: number | null;
    gradesTracked?: string[] | null;
    dateRangeStart?: string | null;
    dateRangeEnd?: string | null;
  } | null;
};

type PokemonPriceTrackerGradeSummary = {
  count?: number | null;
  totalValue?: number | null;
  averagePrice?: number | string | null;
  medianPrice?: number | string | null;
  minPrice?: number | string | null;
  maxPrice?: number | string | null;
  marketPrice7Day?: number | string | null;
  marketPriceMedian7Day?: number | string | null;
  marketTrend?: string | null;
  lastMarketUpdate?: string | null;
  smartMarketPrice?: {
    price?: number | string | null;
    confidence?: string | null;
    method?: string | null;
    daysUsed?: number | null;
  } | null;
};

type PokemonPriceTrackerCardsResponse = {
  data?: unknown;
  card?: unknown;
  matches?: unknown;
  metadata?: {
    total?: number;
    count?: number;
    limit?: number;
    offset?: number;
    hasMore?: boolean;
    planRestrictions?: {
      message?: string;
      limitedTo?: string;
    };
  };
  error?: string;
  message?: string;
};

type PokemonPriceTrackerParseTitleResponse = PokemonPriceTrackerCardsResponse & {
  data?: {
    card?: unknown;
    matches?: unknown;
  };
  prices?: unknown;
};

type PokemonPriceTrackerCardSearchRequest = {
  search: string;
  set?: string;
};

export type PokemonPriceTrackerPricingCandidateWithPayload =
  PokemonPriceTrackerPricingCandidate & {
    rawPayload: unknown;
  };

export type PokemonPriceTrackerPricingLookupResult =
  | {
      status: "match";
      candidate: PokemonPriceTrackerPricingCandidateWithPayload;
      candidates: PokemonPriceTrackerPricingCandidateWithPayload[];
    }
  | {
      status: "needs-review";
      candidates: PokemonPriceTrackerPricingCandidateWithPayload[];
      message: string;
      cardImageUrl?: string | null;
    };

export async function lookupPokemonPriceTrackerPricing({
  apiKey,
  item,
  preferredSourceCardId,
  preferredSourceVariantId
}: {
  apiKey: string;
  item: InventoryItem;
  preferredSourceCardId?: string | null;
  preferredSourceVariantId?: string | null;
}): Promise<PokemonPriceTrackerPricingLookupResult> {
  if (!apiKey) {
    throw new Error("POKEMON_PRICE_TRACKER_API_KEY is not configured.");
  }

  if (item.itemType === "graded" && !gradeBucketForItem(item)) {
    return {
      status: "needs-review",
      candidates: [],
      message: "Add a supported grader and numeric grade before refreshing graded pricing."
    };
  }

  let cards = await searchPokemonPriceTrackerCards({ apiKey, item });
  let candidates = rankedCandidates(item, cards).slice(0, 5);

  if (item.itemType === "graded" && candidates.length === 0) {
    const parsedCards = await parseTitleCards({ apiKey, item });
    cards = mergeCards(cards, parsedCards);
    candidates = rankedCandidates(item, cards).slice(0, 5);
  }

  if (preferredSourceCardId) {
    candidates = prioritizePreferredCandidate(
      candidates,
      preferredSourceCardId,
      preferredSourceVariantId
    );
  }

  if (candidates.length === 0) {
    const [bestCard] = rankedCardMatches(item, cards);
    const cardImageUrl = bestCard ? imageUrlFromCard(bestCard) : null;
    const matchedCardName = bestCard?.name ? String(bestCard.name) : null;

    return {
      status: "needs-review",
      candidates: [],
      message:
        item.itemType === "raw"
          ? "PokemonPriceTracker did not return priced raw-card matches."
          : missingGradedPriceMessage(item, matchedCardName, bestCard),
      cardImageUrl
    };
  }

  const [best, nextBest] = candidates;

  if (
    best &&
    (isPreferredCandidate(best, preferredSourceCardId, preferredSourceVariantId) ||
      isConfidentAutoMatch(best, nextBest))
  ) {
    return {
      status: "match",
      candidate: best,
      candidates
    };
  }

  return {
    status: "needs-review",
    candidates,
    message:
      item.itemType === "raw"
        ? "Choose the best PokemonPriceTracker raw-card match before saving a market price."
        : "Choose the best PokemonPriceTracker graded match before saving a market price."
  };
}

export async function findPokemonPriceTrackerPricingCandidateByIds({
  apiKey,
  item,
  sourceCardId,
  sourceVariantId
}: {
  apiKey: string;
  item: InventoryItem;
  sourceCardId: string;
  sourceVariantId: string;
}) {
  if (!apiKey) {
    throw new Error("POKEMON_PRICE_TRACKER_API_KEY is not configured.");
  }

  const cards = await searchPokemonPriceTrackerCards({ apiKey, item });
  return rankedCandidates(item, cards).find(
    (candidate) =>
      candidate.sourceCardId === sourceCardId && candidate.sourceVariantId === sourceVariantId
  );
}

export async function lookupPokemonPriceTrackerImageCandidates({
  apiKey,
  item,
  preferredSourceCardId
}: {
  apiKey: string;
  item: InventoryItem;
  preferredSourceCardId?: string | null;
}): Promise<CardLookupCandidate[]> {
  if (!apiKey) {
    throw new Error("POKEMON_PRICE_TRACKER_API_KEY is not configured.");
  }

  let cards = preferredSourceCardId
    ? await fetchPokemonPriceTrackerCardsBySourceId({
        apiKey,
        item,
        sourceCardId: preferredSourceCardId,
        includeHistory: false,
        days: 30
      })
    : await searchPokemonPriceTrackerCards({ apiKey, item });

  if (item.itemType === "graded") {
    cards = mergeCards(cards, await parseTitleCards({ apiKey, item }));
  }

  return rankedCardMatches(item, cards)
    .map((card) => pokemonPriceTrackerImageCandidateFromCard(item, card))
    .filter((candidate): candidate is CardLookupCandidate => Boolean(candidate))
    .slice(0, 8);
}

export async function lookupPokemonPriceTrackerHistory({
  apiKey,
  item,
  days,
  sourceCardId
}: {
  apiKey: string;
  item: InventoryItem;
  days: number;
  sourceCardId?: string | null;
}): Promise<PricingHistoryPoint[]> {
  if (!apiKey) {
    throw new Error("POKEMON_PRICE_TRACKER_API_KEY is not configured.");
  }

  const cards = sourceCardId
    ? await fetchPokemonPriceTrackerCardsBySourceId({ apiKey, item, sourceCardId, includeHistory: true, days })
    : await searchPokemonPriceTrackerCards({ apiKey, item, includeHistory: true, days });
  const [best] = rankedCandidates(item, cards);

  if (!best) {
    return [];
  }

  const card = cards.find((candidateCard) => sourceCardIdForCard(candidateCard) === best.sourceCardId);
  return card ? historyPointsFromCard(card, item, days) : [];
}

async function searchPokemonPriceTrackerCards({
  apiKey,
  item,
  includeHistory = false,
  days = 30
}: {
  apiKey: string;
  item: InventoryItem;
  includeHistory?: boolean;
  days?: number;
}) {
  const cardsById = new Map<string, PokemonPriceTrackerCard>();
  const requests = buildSearchRequests(item);

  for (const cardSearch of requests) {
    const cards = await fetchPokemonPriceTrackerCards({
      apiKey,
      cardSearch,
      item,
      includeHistory,
      days
    });

    for (const card of cards) {
      cardsById.set(sourceCardIdForCard(card), card);
    }

    const [best, nextBest] = rankedCandidates(item, Array.from(cardsById.values()));

    if (best && isConfidentAutoMatch(best, nextBest)) {
      break;
    }
  }

  return Array.from(cardsById.values());
}

async function fetchPokemonPriceTrackerCards({
  apiKey,
  cardSearch,
  item,
  includeHistory,
  days
}: {
  apiKey: string;
  cardSearch: PokemonPriceTrackerCardSearchRequest;
  item: InventoryItem;
  includeHistory: boolean;
  days: number;
}) {
  const params = baseCardParams(item, includeHistory, days);
  params.set("search", cardSearch.search);
  if (cardSearch.set) {
    params.set("set", cardSearch.set);
  }
  params.set("limit", "8");

  return fetchCardsWithParams(apiKey, params);
}

async function fetchPokemonPriceTrackerCardsBySourceId({
  apiKey,
  item,
  sourceCardId,
  includeHistory,
  days
}: {
  apiKey: string;
  item: InventoryItem;
  sourceCardId: string;
  includeHistory: boolean;
  days: number;
}) {
  const candidates: PokemonPriceTrackerCard[] = [];
  const numericSourceId = /^\d+$/.test(sourceCardId) ? sourceCardId : null;

  if (numericSourceId) {
    const params = baseCardParams(item, includeHistory, days);
    params.set("tcgPlayerId", numericSourceId);
    candidates.push(...(await fetchCardsWithParams(apiKey, params)));
  }

  const searched = await searchPokemonPriceTrackerCards({ apiKey, item, includeHistory, days });
  return [...candidates, ...searched].filter(
    (card, index, cards) =>
      cards.findIndex((candidate) => sourceCardIdForCard(candidate) === sourceCardIdForCard(card)) === index
  );
}

function baseCardParams(item: InventoryItem, includeHistory: boolean, days: number) {
  const params = new URLSearchParams({
    days: String(Math.max(1, Math.min(days, 90)))
  });

  if (item.itemType === "graded") {
    params.set("includeEbay", "true");

    if (includeHistory) {
      params.set("includeBoth", "true");
    }
  }

  if (includeHistory) {
    params.set("includeHistory", "true");
  }

  const pricingLanguage = pokemonPriceTrackerLanguage(item);

  if (pricingLanguage === "japanese") {
    params.set("language", "japanese");
  } else if (pricingLanguage === "english") {
    params.set("language", "english");
  }

  return params;
}

async function fetchCardsWithParams(apiKey: string, params: URLSearchParams) {
  const response = await fetch(`${pokemonPriceTrackerBaseUrl}/cards?${params}`, {
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${apiKey}`
    }
  });
  const payload = (await response.json().catch(() => ({}))) as PokemonPriceTrackerCardsResponse;

  if (response.status === 429) {
    throw new Error("PokemonPriceTracker rate limit reached. Try again later.");
  }

  if (!response.ok) {
    throw new Error(
      payload.error ?? payload.message ?? `PokemonPriceTracker returned ${response.status}.`
    );
  }

  return cardsFromResponse(payload);
}

async function parseTitleCards({ apiKey, item }: { apiKey: string; item: InventoryItem }) {
  const title = [
    item.certCategory,
    item.card.name,
    item.card.setName,
    item.card.cardNumber,
    item.card.language === "ja" ? "JPN" : null,
    item.grader,
    item.grade,
    item.certNumber ? `CERT ${item.certNumber}` : null
  ]
    .filter(Boolean)
    .join(" ");

  if (!title.trim()) {
    return [];
  }

  const response = await fetch(`${pokemonPriceTrackerBaseUrl}/parse-title`, {
    method: "POST",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      title,
      options: {
        fuzzyMatching: true,
        maxSuggestions: 5,
        includeConfidence: true
      }
    })
  });
  const payload = (await response.json().catch(() => ({}))) as PokemonPriceTrackerParseTitleResponse;

  if (response.status === 429) {
    throw new Error("PokemonPriceTracker rate limit reached. Try again later.");
  }

  if (!response.ok) {
    return [];
  }

  return cardsFromParseTitleResponse(payload);
}

function cardsFromResponse(payload: PokemonPriceTrackerCardsResponse) {
  return normalizeCards([payload.data, payload.card, payload.matches]);
}

function cardsFromParseTitleResponse(payload: PokemonPriceTrackerParseTitleResponse) {
  return normalizeCards([payload.data?.card, payload.data?.matches, payload.card, payload.matches]);
}

function normalizeCards(values: unknown[]) {
  const cards: PokemonPriceTrackerCard[] = [];

  for (const value of values) {
    if (Array.isArray(value)) {
      cards.push(...normalizeCards(value));
      continue;
    }

    if (isRecord(value)) {
      const nestedCard = value.card;

      if (isRecord(nestedCard)) {
        cards.push(nestedCard as PokemonPriceTrackerCard);
      } else if (isProbablyCard(value)) {
        cards.push(value as PokemonPriceTrackerCard);
      }
    }
  }

  return cards;
}

function isProbablyCard(value: Record<string, unknown>) {
  return Boolean(value.name || value.id || value.tcgPlayerId);
}

function buildSearchRequests(item: InventoryItem) {
  const requests: PokemonPriceTrackerCardSearchRequest[] = [];
  const setAliases = uniqueNormalizedStrings([
    ...setSearchAliases(item.card.setName),
    ...setSearchAliases(item.card.setCode),
    ...setSearchAliases([item.card.setName, item.variantDetails].filter(Boolean).join(" "))
  ]);
  const nameAliases = cardNameSearchAliases(item.card.name);

  for (const name of nameAliases) {
    for (const setAlias of setAliases) {
      requests.push({ search: name, set: setAlias });
    }
  }

  const naturalQueries = [
    ...nameAliases.flatMap((name) => [
      [name, item.card.setName, normalizeCardNumber(item.card.cardNumber)].filter(Boolean).join(" "),
      [name, item.card.setName].filter(Boolean).join(" "),
      [name, normalizeCardNumber(item.card.cardNumber)].filter(Boolean).join(" "),
      [name, item.card.cardNumber].filter(Boolean).join(" "),
      name
    ])
  ];

  for (const query of naturalQueries) {
    requests.push({ search: query });
  }

  const seen = new Set<string>();

  return requests.filter((request) => {
    const normalizedSearch = normalizeText(request.search);
    const normalizedSet = normalizeText(request.set);
    const key = `${normalizedSearch}|${normalizedSet}`;

    if (!normalizedSearch || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function uniqueNormalizedStrings(values: Array<string | null | undefined>) {
  return values.filter(
    (value, index, allValues) =>
      value &&
      allValues.findIndex((candidate) => normalizeText(candidate) === normalizeText(value)) === index
  ) as string[];
}

function cardNameSearchAliases(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  const cleaned = cleanCardNameVariantSuffix(raw);
  const withoutHyphenBeforeSuffix = cleaned.replace(
    /\s*[-–—]\s*(gx|ex|vstar|vmax|v-union|v)\s*$/i,
    " $1"
  );
  const apiSearchStyle = withoutHyphenBeforeSuffix
    .replace(/&/g, " ")
    .replace(/\b(?:and)\b/gi, " ")
    .replace(/\s*\+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withoutGameSuffix = apiSearchStyle
    .replace(/\s+(?:gx|ex|vstar|vmax|v union|v)\s*$/i, "")
    .trim();
  const translatedJapaneseName = translatedJapaneseCardNameAlias(apiSearchStyle);
  const correctedCommonTypo = apiSearchStyle.replace(/\bradient\b/i, "Radiant");
  const psaLabelName = psaLabelCardNameAlias(apiSearchStyle);

  return [
    raw,
    cleaned,
    withoutHyphenBeforeSuffix,
    apiSearchStyle,
    withoutGameSuffix,
    translatedJapaneseName,
    correctedCommonTypo,
    psaLabelName
  ].filter(
    (name, index, names) =>
      name && names.findIndex((candidate) => normalizeText(candidate) === normalizeText(name)) === index
  );
}

function translatedJapaneseCardNameAlias(value: string) {
  const withoutRadiantPrefix = value.replace(/かがやく/g, "").trim();

  if (withoutRadiantPrefix && withoutRadiantPrefix !== value) {
    return `Radiant ${withoutRadiantPrefix}`;
  }

  return "";
}

function psaLabelCardNameAlias(value: string) {
  const normalized = normalizeText(value);

  if (normalized.includes("imakuni") && normalized.includes("pc")) {
    return "Imakuni?'s PC";
  }

  if (normalized.includes("imakuni") && normalized.includes("corner")) {
    return "Imakuni?'s Corner";
  }

  if (normalized.includes("imakuni") && normalized.includes("nasty")) {
    return "Imakuni?'s Nasty Plot";
  }

  return "";
}

function cleanCardNameVariantSuffix(value: string) {
  return cleanCardNameVariantPrefix(value)
    .replace(/\s*[-–—]\s*(?:holo|foil|reverse holo|reverse foil)\s*$/i, "")
    .replace(/\s*\((?:holo|foil|reverse holo|reverse foil)\)\s*$/i, "")
    .trim();
}

function cleanCardNameVariantPrefix(value: string) {
  return value
    .replace(
      /^\s*(?:alternate art|full art|hyper rare|illustration rare|secret rare|special art|special illustration rare)\s*\/\s*/i,
      ""
    )
    .trim();
}

function setSearchAliases(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  const aliases = [raw];
  const withoutParentheses = raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();

  if (withoutParentheses && withoutParentheses !== raw) {
    aliases.push(withoutParentheses);
  }

  const withoutTrailingBaseSet = withoutParentheses.replace(/\s+base\s+set$/i, "").trim();

  if (
    withoutTrailingBaseSet &&
    withoutTrailingBaseSet !== withoutParentheses &&
    normalizeText(withoutParentheses) !== "base set"
  ) {
    aliases.push(withoutTrailingBaseSet);
  }

  aliases.push(...englishSetAliases(raw), ...japaneseSetAliases(raw));

  return aliases.filter(
    (alias, index, allAliases) =>
      alias && allAliases.findIndex((candidate) => normalizeText(candidate) === normalizeText(alias)) === index
  );
}

function englishSetAliases(value: string | null | undefined) {
  const normalized = normalizeText(value);
  const aliases: string[] = [];

  if (
    normalized.includes("wizards black star") ||
    normalized.includes("black star promo") ||
    normalized === "basep"
  ) {
    aliases.push("WoTC Promo", "Wizards Promo");
  }

  if (normalized.includes("sm black star")) {
    aliases.push("SM Promos");
  }

  if (normalized.includes("swsh black star")) {
    aliases.push("SWSH Promos");
  }

  if (normalized.includes("xy black star")) {
    aliases.push("XY Promos");
  }

  if (normalized.includes("bw black star")) {
    aliases.push("BW Promos");
  }

  if (normalized.includes("dp black star")) {
    aliases.push("DP Promos");
  }

  if (normalized.includes("hgss black star")) {
    aliases.push("HGSS Promos");
  }

  return aliases;
}

function japaneseSetAliases(value: string | null | undefined) {
  const normalized = normalizeText(value);
  const aliases: string[] = [];

  if (
    normalized.includes("s10b") ||
    normalized.includes("pokemon go") ||
    normalized.includes("pok mon go")
  ) {
    aliases.push("S10b: Pokemon GO", "Pokemon GO");
  }

  if (
    normalized.includes("cp3") ||
    normalized.includes("pokekyun") ||
    normalized.includes("poke kyun") ||
    normalized.includes("ポケキュン")
  ) {
    aliases.push("CP3: PokeKyun Collection", "PokeKyun Collection");
  }

  if (normalized.includes("japanese vending") || normalized.includes("vending machine")) {
    aliases.push("Vending Machine cards");

    if (normalized.includes("series iii") || normalized.includes("series 3")) {
      aliases.push("Vending Machine cards Series 3 (Green)");
    } else if (normalized.includes("series ii") || normalized.includes("series 2")) {
      aliases.push("Vending Machine cards Series 2 (Red)");
    } else if (normalized.includes("series i") || normalized.includes("series 1")) {
      aliases.push("Vending Machine cards Series 1 (Blue)");
    }
  }

  if (normalized.includes("japanese neo 1")) {
    aliases.push("Gold, Silver, to a New World...", "Neo Genesis");
  }

  if (normalized.includes("japanese neo 2")) {
    aliases.push("Crossing the Ruins...", "Neo Discovery");
  }

  if (normalized.includes("japanese neo 3")) {
    aliases.push("Awakening Legends", "Neo Revelation");
  }

  if (normalized.includes("japanese neo 4")) {
    aliases.push("Darkness, and to Light...", "Neo Destiny");
  }

  return aliases;
}

function rankedCandidates(item: InventoryItem, cards: PokemonPriceTrackerCard[]) {
  return cards
    .flatMap((card) =>
      item.itemType === "raw" ? rawCandidateFromCard(item, card) : gradedCandidateFromCard(item, card)
    )
    .sort((left, right) => right.score - left.score);
}

function rankedCardMatches(item: InventoryItem, cards: PokemonPriceTrackerCard[]) {
  return cards
    .filter((card) => !cardIdentityConflicts(item, card))
    .map((card) => ({ card, score: scoreCard(item, card) }))
    .filter(({ score }) => score >= 8)
    .sort((left, right) => right.score - left.score)
    .map(({ card }) => card);
}

function mergeCards(left: PokemonPriceTrackerCard[], right: PokemonPriceTrackerCard[]) {
  return [...left, ...right].filter(
    (card, index, cards) =>
      cards.findIndex((candidate) => sourceCardIdForCard(candidate) === sourceCardIdForCard(card)) === index
  );
}

function pokemonPriceTrackerImageCandidateFromCard(
  item: InventoryItem,
  card: PokemonPriceTrackerCard
): CardLookupCandidate | null {
  const imageUrl = imageUrlFromCard(card);

  if (!imageUrl) {
    return null;
  }

  const score = scoreCard(item, card);
  const sourceId = sourceCardIdForCard(card);
  const name = String(card.name ?? item.card.name);
  const setName = card.setName ?? card.set ?? item.card.setName ?? null;
  const cardNumber = normalizedDisplayCardNumber(card) || item.card.cardNumber || null;
  const rarity = card.rarity ?? item.card.rarity ?? null;

  return {
    id: `pokemonpricetracker:${sourceId}`,
    source: "pokemonpricetracker",
    sourceId,
    confidence: confidenceFromScore(score),
    name,
    setName,
    setCode: item.card.setCode ?? null,
    cardNumber,
    language: item.card.language,
    rarity,
    imageUrl,
    score,
    item: {
      name,
      setName: setName ?? "",
      setCode: item.card.setCode ?? "",
      cardNumber: cardNumber ?? "",
      language: item.card.language,
      rarity: rarity ?? "",
      releaseYear: item.card.releaseYear ?? "",
      imageUrl,
      itemType: item.itemType,
      quantity: item.quantity,
      conditionLabel: item.conditionLabel ?? "",
      conditionScore: item.conditionScore ?? undefined,
      variantDetails: item.variantDetails ?? "",
      grader: item.grader ?? "",
      grade: item.grade ?? "",
      certNumber: item.certNumber ?? "",
      purchasePriceCents: item.purchasePriceCents ?? undefined,
      purchaseDate: item.purchaseDate ?? "",
      valueOverrideCents: item.valueOverrideCents ?? undefined,
      storageLocation: item.storageLocation ?? "",
      notes: item.notes ?? "",
      certUrl: item.certUrl ?? "",
      certSpecId: item.certSpecId ?? "",
      certCategory: item.certCategory ?? "",
      certPopulation: item.certPopulation ?? "",
      certPopulationHigher: item.certPopulationHigher ?? "",
      certEstimateCents: item.certEstimateCents ?? undefined,
      certLookupAt: item.certLookupAt ?? ""
    }
  };
}

function rawCandidateFromCard(
  item: InventoryItem,
  card: PokemonPriceTrackerCard
): PokemonPriceTrackerPricingCandidateWithPayload[] {
  if (cardIdentityConflicts(item, card)) {
    return [];
  }

  const rawPrice = rawPriceFromCard(card, item);

  if (!rawPrice) {
    return [];
  }

  const score = scoreCard(item, card);
  const sourceVariantId = rawPrice.variantId ?? printingLabel(card, item) ?? "raw";

  return [
    {
      sourceCardId: sourceCardIdForCard(card),
      sourceVariantId,
      matchedName: String(card.name ?? "Unknown card"),
      matchedSetName: card.setName ?? card.set ?? null,
      matchedCardNumber: normalizedDisplayCardNumber(card),
      condition: item.conditionLabel,
      printing: rawPrice.printing ?? printingLabel(card, item),
      language: item.card.language,
      priceCents: rawPrice.priceCents,
      currency: "USD",
      confidence: confidenceFromScore(score),
      score,
      source: "pokemonpricetracker",
      priceKind: "raw",
      grader: null,
      grade: null,
      gradeBucket: null,
      saleCount: rawPrice.saleCount,
      averagePriceCents: rawPrice.averagePriceCents,
      medianPriceCents: rawPrice.medianPriceCents,
      minPriceCents: rawPrice.minPriceCents,
      maxPriceCents: rawPrice.maxPriceCents,
      marketTrend: rawPrice.marketTrend,
      historyAvailable: Boolean(card.priceHistory || card.history),
      rawPayload: {
        card: publicCardPayload(card),
        rawPrice
      }
    }
  ];
}

function gradedCandidateFromCard(
  item: InventoryItem,
  card: PokemonPriceTrackerCard
): PokemonPriceTrackerPricingCandidateWithPayload[] {
  if (cardIdentityConflicts(item, card)) {
    return [];
  }

  const gradeBucket = gradeBucketForItem(item);

  if (!gradeBucket) {
    return [];
  }

  const gradeSummary = card.ebay?.salesByGrade?.[gradeBucket];
  const priceCents = gradedPriceToCents(gradeSummary);

  if (!gradeSummary || priceCents === null) {
    return [];
  }

  const score = scoreCard(item, card);
  const grader = normalizeGrader(item.grader).toUpperCase();
  const grade = displayGrade(item.grade);

  return [
    {
      sourceCardId: sourceCardIdForCard(card),
      sourceVariantId: gradeBucket,
      matchedName: String(card.name ?? "Unknown card"),
      matchedSetName: card.setName ?? card.set ?? null,
      matchedCardNumber: normalizedDisplayCardNumber(card),
      condition: `${grader} ${grade}`.trim() || gradeBucket.toUpperCase(),
      printing: printingLabel(card, item),
      language: item.card.language,
      priceCents,
      currency: "USD",
      confidence: confidenceFromScore(score),
      score,
      source: "pokemonpricetracker",
      priceKind: "graded",
      grader,
      grade,
      gradeBucket,
      saleCount: Number(gradeSummary.count ?? 0),
      averagePriceCents: priceToCents(gradeSummary.averagePrice),
      medianPriceCents: priceToCents(gradeSummary.medianPrice),
      minPriceCents: priceToCents(gradeSummary.minPrice),
      maxPriceCents: priceToCents(gradeSummary.maxPrice),
      marketTrend: gradeSummary.marketTrend ?? null,
      historyAvailable: Boolean(card.priceHistory || card.history),
      rawPayload: {
        card: publicCardPayload(card),
        ebay: {
          updatedAt: card.ebay?.updatedAt ?? null,
          lastScrapedDate: card.ebay?.lastScrapedDate ?? null,
          lastEbayCheck: card.ebay?.lastEbayCheck ?? null,
          totalSales: card.ebay?.totalSales ?? null,
          totalValue: card.ebay?.totalValue ?? null,
          dateRangeStart: card.ebay?.dateRangeStart ?? null,
          dateRangeEnd: card.ebay?.dateRangeEnd ?? null
        },
        gradeBucket,
        gradeSummary
      }
    }
  ];
}

function rawPriceFromCard(card: PokemonPriceTrackerCard, item: InventoryItem) {
  const prices = isRecord(card.prices) ? card.prices : {};
  const itemVariants = itemVariantPreferenceText(item);
  const candidates = collectRawPriceCandidates(prices, itemVariants);
  const pricedCandidates = candidates.filter((candidate) => candidate.priceCents !== null) as Array<
    Omit<RawPriceCandidate, "priceCents"> & { priceCents: number }
  >;

  return pricedCandidates.sort((left, right) => right.score - left.score)[0] ?? null;
}

type RawPriceCandidate = {
  variantId: string;
  printing: string | null;
  priceCents: number | null;
  saleCount: number | null;
  averagePriceCents: number | null;
  medianPriceCents: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  marketTrend: string | null;
  score: number;
};

function collectRawPriceCandidates(prices: Record<string, unknown>, itemVariants: string) {
  const candidates: RawPriceCandidate[] = [];
  const nonPriceKeys = new Set([
    "lastUpdated",
    "listings",
    "low",
    "market",
    "marketPrice",
    "primaryPrinting",
    "sellers",
    "tcgPlayerMarket",
    "tcgplayerMarket",
    "variants"
  ]);

  for (const [key, value] of Object.entries(prices)) {
    if (nonPriceKeys.has(key)) {
      continue;
    }

    if (typeof value === "number" || typeof value === "string") {
      candidates.push({
        variantId: key,
        printing: humanizePriceKey(key),
        priceCents: priceToCents(value),
        saleCount: null,
        averagePriceCents: null,
        medianPriceCents: null,
        minPriceCents: null,
        maxPriceCents: null,
        marketTrend: null,
        score: rawPriceVariantScore(itemVariants, key)
      });
      continue;
    }

    if (!isRecord(value)) {
      continue;
    }

    const price =
      value.market ??
      value.marketPrice ??
      value.price ??
      value.value ??
      value.average ??
      value.avg ??
      value.median;
    candidates.push({
      variantId: key,
      printing: humanizePriceKey(String(value.printing ?? value.condition ?? key)),
      priceCents: priceToCents(price),
      saleCount: numberOrNull(value.count ?? value.salesCount ?? value.volume),
      averagePriceCents: priceToCents(value.averagePrice ?? value.average ?? value.avg),
      medianPriceCents: priceToCents(value.medianPrice ?? value.median),
      minPriceCents: priceToCents(value.minPrice ?? value.low ?? value.min),
      maxPriceCents: priceToCents(value.maxPrice ?? value.high ?? value.max),
      marketTrend: typeof value.marketTrend === "string" ? value.marketTrend : null,
      score: rawPriceVariantScore(itemVariants, `${key} ${JSON.stringify(value)}`)
    });
  }

  const directMarket =
    prices.market ?? prices.marketPrice ?? prices.tcgplayerMarket ?? prices.tcgPlayerMarket;

  if (directMarket !== undefined) {
    candidates.push({
      variantId: "market",
      printing: typeof prices.primaryPrinting === "string" ? prices.primaryPrinting : null,
      priceCents: priceToCents(directMarket),
      saleCount: null,
      averagePriceCents: priceToCents(prices.averagePrice ?? prices.average),
      medianPriceCents: priceToCents(prices.medianPrice ?? prices.median),
      minPriceCents: priceToCents(prices.low ?? prices.minPrice),
      maxPriceCents: priceToCents(prices.high ?? prices.maxPrice),
      marketTrend: typeof prices.marketTrend === "string" ? prices.marketTrend : null,
      score: rawPriceVariantScore(itemVariants, String(prices.primaryPrinting ?? "market"))
    });
  }

  if (isRecord(prices.variants)) {
    candidates.push(...collectNestedRawVariantCandidates(prices.variants, itemVariants));
  }

  return candidates;
}

function collectNestedRawVariantCandidates(
  variants: Record<string, unknown>,
  itemVariants: string
) {
  const candidates: RawPriceCandidate[] = [];

  for (const [printing, conditionValues] of Object.entries(variants)) {
    if (!isRecord(conditionValues)) {
      continue;
    }

    for (const [condition, value] of Object.entries(conditionValues)) {
      const sourceText = `${printing} ${condition}`;
      const priceRecord = isRecord(value) ? value : { price: value };
      const price =
        priceRecord.market ??
        priceRecord.marketPrice ??
        priceRecord.price ??
        priceRecord.value ??
        priceRecord.average ??
        priceRecord.avg ??
        priceRecord.median;

      candidates.push({
        variantId: `${normalizeText(printing).replace(/\s+/g, "-") || "variant"}:${
          normalizeText(condition).replace(/\s+/g, "-") || "condition"
        }`,
        printing: humanizePriceKey(sourceText),
        priceCents: priceToCents(price),
        saleCount: numberOrNull(priceRecord.count ?? priceRecord.salesCount ?? priceRecord.volume),
        averagePriceCents: priceToCents(priceRecord.averagePrice ?? priceRecord.average ?? priceRecord.avg),
        medianPriceCents: priceToCents(priceRecord.medianPrice ?? priceRecord.median),
        minPriceCents: priceToCents(priceRecord.minPrice ?? priceRecord.low ?? priceRecord.min),
        maxPriceCents: priceToCents(priceRecord.maxPrice ?? priceRecord.high ?? priceRecord.max),
        marketTrend: typeof priceRecord.marketTrend === "string" ? priceRecord.marketTrend : null,
        score: rawPriceVariantScore(itemVariants, sourceText)
      });
    }
  }

  return candidates;
}

function rawPriceVariantScore(itemVariants: string, source: string) {
  const sourceText = normalizeText(source);
  let score = 0;

  score += variantScore(itemVariants, sourceText);

  if (!itemVariants && (sourceText.includes("normal") || sourceText.includes("unlimited"))) {
    score += 2;
  }

  if (!itemVariants && (sourceText.includes("1st edition") || sourceText.includes("shadowless"))) {
    score -= 8;
  }

  return score;
}

function gradedPriceToCents(summary: PokemonPriceTrackerGradeSummary | undefined) {
  return (
    priceToCents(summary?.smartMarketPrice?.price) ??
    priceToCents(summary?.marketPriceMedian7Day) ??
    priceToCents(summary?.marketPrice7Day) ??
    priceToCents(summary?.medianPrice) ??
    priceToCents(summary?.averagePrice)
  );
}

function missingGradedPriceMessage(
  item: InventoryItem,
  matchedCardName: string | null,
  card: PokemonPriceTrackerCard | undefined
) {
  if (!matchedCardName) {
    return "PokemonPriceTracker did not return priced graded-card matches.";
  }

  const requestedGrader = normalizeGrader(item.grader);
  const requestedLabel = gradeLabelForItem(item);
  const sameGraderBuckets = availableGradeBucketLabels(card, requestedGrader);
  const anyBuckets = availableGradeBucketLabels(card).slice(0, 8);
  let message = `PokemonPriceTracker found ${matchedCardName}, but the API did not return a ${requestedLabel} price bucket.`;

  if (sameGraderBuckets.length > 0) {
    message += ` Available ${requestedGrader.toUpperCase()} buckets: ${sameGraderBuckets.join(", ")}.`;
  } else if (anyBuckets.length > 0) {
    message += ` Available graded buckets: ${anyBuckets.join(", ")}.`;
  }

  return message;
}

function availableGradeBucketLabels(
  card: PokemonPriceTrackerCard | undefined,
  graderFilter?: string | null
) {
  const salesByGrade = card?.ebay?.salesByGrade;

  if (!salesByGrade) {
    return [];
  }

  const normalizedFilter = normalizeGrader(graderFilter);

  return Object.entries(salesByGrade)
    .filter(([, summary]) => gradedPriceToCents(summary) !== null)
    .map(([bucket]) => ({ bucket, label: gradeBucketLabel(bucket) }))
    .filter(({ bucket, label }) => {
      if (!label) {
        return false;
      }

      return !normalizedFilter || normalizeGrader(bucket).startsWith(normalizedFilter);
    })
    .map(({ label }) => label)
    .filter((label, index, labels) => labels.findIndex((candidate) => candidate === label) === index);
}

function gradeLabelForItem(item: InventoryItem) {
  return [normalizeGrader(item.grader).toUpperCase(), displayGrade(item.grade)]
    .filter(Boolean)
    .join(" ");
}

function gradeBucketLabel(bucket: string) {
  const match = bucket.match(/^([a-z]+)(\d+(?:[_\.]\d+)?)$/i);

  if (!match) {
    return "";
  }

  return `${match[1].toUpperCase()} ${match[2].replace("_", ".")}`;
}

function scoreCard(item: InventoryItem, card: PokemonPriceTrackerCard) {
  let score = 0;
  const itemName = normalizeCardNameForMatch(item.card.name);
  const cardName = normalizeCardNameForMatch(card.name);
  const itemNumber = normalizeCardNumber(item.card.cardNumber);
  const cardNumber = normalizeCardNumber(card.cardNumber ?? card.number);
  const itemSetName = itemSetIdentityText(item);
  const cardSetName = normalizeText(card.setName ?? card.set);
  const namesEquivalent = cardNamesEquivalent(item.card.name, card.name);
  const setsEquivalent = itemSetNamesEquivalent(item, cardSetName);
  const itemVariants = itemVariantPreferenceText(item);
  const sourceText = normalizeText(
    [
      card.name,
      card.setName,
      card.set,
      card.rarity,
      isRecord(card.prices) ? card.prices.primaryPrinting : null,
      card.printingsAvailable?.join(" ")
    ].join(" ")
  );

  if (namesEquivalent) {
    score += 7;
  } else if (cardName.includes(itemName) || itemName.includes(cardName)) {
    score += 3;
  }

  if (itemNumber && cardNumbersMatch(itemNumber, cardNumber)) {
    score += 6;
  } else if (itemNumber && cardNumber) {
    score -= 4;
  } else if (itemNumber && !(namesEquivalent && setsEquivalent)) {
    score -= 2;
  }

  if (setsEquivalent) {
    score += 5;
  } else if (itemSetName && (cardSetName.includes(itemSetName) || itemSetName.includes(cardSetName))) {
    score += 3;
  } else if (itemSetName && sharesMeaningfulSetToken(itemSetName, cardSetName)) {
    score += 2;
  } else if (itemSetName) {
    score -= 3;
  }

  score += variantScore(itemVariants, sourceText);

  return score;
}

function cardIdentityConflicts(item: InventoryItem, card: PokemonPriceTrackerCard) {
  const itemNumber = normalizeCardNumber(item.card.cardNumber);
  const cardNumber = normalizeCardNumber(card.cardNumber ?? card.number);
  const itemSetName = itemSetIdentityText(item);
  const cardSetName = normalizeText(card.setName ?? card.set);
  const itemName = normalizeCardNameForMatch(item.card.name);
  const cardName = normalizeCardNameForMatch(card.name);

  if (itemNumber && cardNumber && !cardNumbersMatch(itemNumber, cardNumber)) {
    return true;
  }

  if (itemName && cardName && !cardNamesEquivalent(item.card.name, card.name)) {
    return true;
  }

  if (itemSetName && cardSetName && !itemSetNamesCompatible(item, cardSetName)) {
    return true;
  }

  return false;
}

function setNamesCompatible(left: string, right: string) {
  return (
    setNamesEquivalent(left, right) ||
    sharesMeaningfulSetToken(left, right)
  );
}

function itemSetNamesEquivalent(item: InventoryItem, cardSetName: string) {
  return itemSetNames(item).some((itemSetName) => setNamesEquivalent(itemSetName, cardSetName));
}

function itemSetNamesCompatible(item: InventoryItem, cardSetName: string) {
  return itemSetNames(item).some((itemSetName) => setNamesCompatible(itemSetName, cardSetName));
}

function itemSetNames(item: InventoryItem) {
  return [item.card.setName, item.card.setCode]
    .map((value) => normalizeText(value))
    .filter(
      (value, index, values) =>
        value && values.findIndex((candidate) => candidate === value) === index
    );
}

function itemSetIdentityText(item: InventoryItem) {
  return itemSetNames(item).join(" ");
}

function setNamesEquivalent(left: string, right: string) {
  const leftAliases = normalizedSetAliases(left);
  const rightAliases = normalizedSetAliases(right);

  return leftAliases.some((leftAlias) =>
    rightAliases.some(
      (rightAlias) =>
        leftAlias === rightAlias ||
        leftAlias.includes(rightAlias) ||
        rightAlias.includes(leftAlias)
    )
  );
}

function normalizedSetAliases(value: string | null | undefined) {
  const aliases = setSearchAliases(value);
  const normalized = normalizeText(value);

  if (normalized) {
    aliases.push(normalized);
  }

  return aliases
    .map((alias) => normalizeText(alias))
    .filter(
      (alias, index, allAliases) =>
        alias && allAliases.findIndex((candidate) => candidate === alias) === index
    );
}

function pokemonPriceTrackerLanguage(item: InventoryItem) {
  const identity = normalizeText(
    [item.card.language, item.card.name, item.card.setName, item.card.setCode, item.variantDetails]
      .filter(Boolean)
      .join(" ")
  );

  if (
    item.card.language === "ja" ||
    identity.includes("japanese") ||
    identity.includes("vending") ||
    identity.includes("pokekyun")
  ) {
    return "japanese";
  }

  if (item.card.language === "en") {
    return "english";
  }

  return null;
}

function itemVariantPreferenceText(item: InventoryItem) {
  return normalizeText([item.variantDetails, item.card.rarity].filter(Boolean).join(" "));
}

function normalizeCardNameForMatch(value: string | number | null | undefined) {
  return normalizeText(
    cleanCardNameVariantSuffix(
      String(value ?? "").replace(/\s*\(\s*#?\d+[a-z]?\s*\)\s*$/i, "")
    )
  );
}

function cardNamesEquivalent(
  itemName: string | number | null | undefined,
  cardName: string | number | null | undefined
) {
  const itemAliases = normalizedCardNameAliases(itemName);
  const cardAliases = normalizedCardNameAliases(cardName);

  return itemAliases.some((itemAlias) =>
    cardAliases.some(
      (cardAlias) =>
        itemAlias === cardAlias ||
        (itemAlias.length >= 4 &&
          cardAlias.length >= 4 &&
          (itemAlias.includes(cardAlias) || cardAlias.includes(itemAlias)))
    )
  );
}

function normalizedCardNameAliases(value: string | number | null | undefined) {
  const aliases = cardNameSearchAliases(String(value ?? ""));
  const normalized = normalizeCardNameForMatch(value);

  if (normalized) {
    aliases.push(normalized);
  }

  return aliases
    .map((alias) => normalizeCardNameForMatch(alias))
    .filter(
      (alias, index, allAliases) =>
        alias && allAliases.findIndex((candidate) => candidate === alias) === index
    );
}

function variantScore(itemVariants: string, sourceText: string) {
  let score = 0;
  const wantsFirstEdition = itemVariants.includes("1st edition");
  const sourceFirstEdition =
    sourceText.includes("1st edition") || sourceText.includes("first edition");
  const wantsShadowless = itemVariants.includes("shadowless");
  const sourceShadowless = sourceText.includes("shadowless");
  const wantsReverse = itemVariants.includes("reverse");
  const sourceReverse = sourceText.includes("reverse");
  const wantsFoil =
    itemVariants.includes("holo") || itemVariants.includes("foil") || itemVariants.includes("shiny");
  const sourceFoil = sourceText.includes("holo") || sourceText.includes("foil");

  if (wantsFirstEdition && sourceFirstEdition) {
    score += 6;
  } else if (wantsFirstEdition && !sourceFirstEdition) {
    score -= 3;
  } else if (!wantsFirstEdition && sourceFirstEdition) {
    score -= 6;
  }

  if (wantsShadowless && sourceShadowless) {
    score += 5;
  } else if (!wantsShadowless && sourceShadowless) {
    score -= 8;
  }

  if (wantsReverse && sourceReverse) {
    score += 4;
  } else if (wantsReverse && !sourceReverse) {
    score -= 3;
  } else if (!wantsReverse && sourceReverse) {
    score -= 2;
  }

  if (wantsFoil && sourceFoil && !sourceReverse) {
    score += 2;
  } else if (wantsFoil && !sourceFoil) {
    score -= 2;
  }

  return score;
}

function isConfidentAutoMatch(
  best: PokemonPriceTrackerPricingCandidateWithPayload,
  nextBest: PokemonPriceTrackerPricingCandidateWithPayload | undefined
) {
  if (best.priceKind === "raw" && !nextBest) {
    return best.score >= 12;
  }

  if (best.priceKind === "graded" && !nextBest) {
    return best.score >= 8;
  }

  if (best.priceKind === "graded" && best.score >= 15) {
    return true;
  }

  if (
    best.priceKind === "graded" &&
    best.score >= 11 &&
    (!nextBest || best.score - nextBest.score >= 2)
  ) {
    return true;
  }

  return best.score >= 15 && (!nextBest || best.score - nextBest.score >= 3);
}

function prioritizePreferredCandidate(
  candidates: PokemonPriceTrackerPricingCandidateWithPayload[],
  sourceCardId: string,
  sourceVariantId: string | null | undefined
) {
  return [...candidates].sort((left, right) => {
    const leftPreferred = isPreferredCandidate(left, sourceCardId, sourceVariantId) ? 1 : 0;
    const rightPreferred = isPreferredCandidate(right, sourceCardId, sourceVariantId) ? 1 : 0;

    return rightPreferred - leftPreferred || right.score - left.score;
  });
}

function isPreferredCandidate(
  candidate: PokemonPriceTrackerPricingCandidateWithPayload,
  sourceCardId: string | null | undefined,
  sourceVariantId: string | null | undefined
) {
  if (!sourceCardId || candidate.sourceCardId !== sourceCardId) {
    return false;
  }

  return !sourceVariantId || candidate.sourceVariantId === sourceVariantId;
}

function confidenceFromScore(score: number): MarketPriceConfidence {
  if (score >= 15) {
    return "exact";
  }

  if (score >= 11) {
    return "strong";
  }

  return "possible";
}

function gradeBucketForItem(item: InventoryItem) {
  const grader = normalizeGrader(item.grader);
  const grade = normalizeGrade(item.grade);

  if (!grader || !grade) {
    return null;
  }

  if (!["psa", "bgs", "cgc", "sgc"].includes(grader)) {
    return null;
  }

  return `${grader}${grade.replace(".", "_")}`;
}

function normalizeGrader(value: string | null | undefined) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeGrade(value: string | null | undefined) {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);

  if (!match) {
    return "";
  }

  return match[0].replace(/\.0$/, "");
}

function displayGrade(value: string | null | undefined) {
  return normalizeGrade(value) || String(value ?? "").trim();
}

function priceToCents(value: unknown) {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? Math.round(price * 100) : null;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sourceCardIdForCard(card: PokemonPriceTrackerCard) {
  return String(card.id || card.tcgPlayerId || card.externalCatalogId || card.name || "unknown");
}

function normalizedDisplayCardNumber(card: PokemonPriceTrackerCard) {
  const cardNumber = String(card.cardNumber ?? card.number ?? "").trim();
  const totalSetNumber = String(card.totalSetNumber ?? "").trim();

  if (cardNumber && totalSetNumber && !cardNumber.includes("/")) {
    return `${cardNumber}/${totalSetNumber}`;
  }

  return cardNumber || null;
}

function printingLabel(card: PokemonPriceTrackerCard, item: InventoryItem) {
  const primaryPrinting = isRecord(card.prices) ? card.prices.primaryPrinting : null;

  return (
    item.variantDetails ||
    (typeof primaryPrinting === "string" ? primaryPrinting : null) ||
    card.printingsAvailable?.find((printing) => Boolean(printing)) ||
    null
  );
}

function historyPointsFromCard(
  card: PokemonPriceTrackerCard,
  item: InventoryItem,
  days: number
): PricingHistoryPoint[] {
  const values = flattenHistoryValues([card.priceHistory, card.history, isRecord(card.prices) ? card.prices.history : null]);
  const cutoff = Date.now() - Math.max(1, Math.min(days, 90)) * 24 * 60 * 60 * 1000;

  return values
    .map((value) => historyPointFromValue(value, item.itemType))
    .filter((point): point is PricingHistoryPoint => {
      if (!point) {
        return false;
      }

      const time = new Date(point.date).getTime();
      return !Number.isNaN(time) && time >= cutoff;
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

function flattenHistoryValues(values: unknown[]): unknown[] {
  const flattened: unknown[] = [];

  for (const value of values) {
    if (Array.isArray(value)) {
      flattened.push(...flattenHistoryValues(value));
    } else if (isRecord(value)) {
      for (const [key, nestedValue] of Object.entries(value)) {
        if (Array.isArray(nestedValue)) {
          flattened.push(...flattenHistoryValues(nestedValue));
        } else if (isRecord(nestedValue)) {
          flattened.push({ date: key, ...nestedValue });
        }
      }
    }
  }

  return flattened;
}

function historyPointFromValue(value: unknown, priceKind: InventoryItemType): PricingHistoryPoint | null {
  if (!isRecord(value)) {
    return null;
  }

  const date = String(value.date ?? value.day ?? value.timestamp ?? "").slice(0, 10);
  const price =
    value.market ??
    value.marketPrice ??
    value.price ??
    value.value ??
    value.average ??
    value.avg ??
    value.median;
  const priceCents = priceToCents(price);

  if (!date || priceCents === null) {
    return null;
  }

  return {
    date,
    priceCents,
    source: "pokemonpricetracker",
    priceKind
  };
}

function publicCardPayload(card: PokemonPriceTrackerCard) {
  return {
    id: card.id,
    tcgPlayerId: card.tcgPlayerId,
    externalCatalogId: card.externalCatalogId,
    tcgPlayerUrl: card.tcgPlayerUrl,
    name: card.name,
    setName: card.setName ?? card.set ?? null,
    cardNumber: card.cardNumber ?? card.number ?? null,
    totalSetNumber: card.totalSetNumber,
    rarity: card.rarity,
    imageUrl: imageUrlFromCard(card)
  };
}

function imageUrlFromCard(card: PokemonPriceTrackerCard) {
  return (
    card.imageCdnUrl800 ??
    card.imageCdnUrl400 ??
    card.imageUrl ??
    card.imageCdnUrl ??
    card.images?.large ??
    card.images?.small ??
    card.image ??
    card.imageCdnUrl200 ??
    null
  );
}

function humanizePriceKey(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
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
    .split("/")
    .map((part) => part.replace(/^0+(?=\d)/, ""))
    .join("/");
}

function cardNumbersMatch(left: string, right: string) {
  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  return firstCardNumberPart(left) === firstCardNumberPart(right);
}

function firstCardNumberPart(value: string) {
  return value.split("/")[0] ?? value;
}

function sharesMeaningfulSetToken(left: string, right: string) {
  const ignored = new Set(["pokemon", "card", "the", "set", "base", "sm", "xy", "swsh"]);
  const leftTokens = left.split(" ").filter((token) => token.length > 2 && !ignored.has(token));
  const rightTokens = new Set(right.split(" "));

  return leftTokens.some((token) => rightTokens.has(token));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
