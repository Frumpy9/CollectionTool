import type {
  InventoryItem,
  JustTcgPricingCandidate,
  MarketPriceConfidence
} from "@collection-tool/shared";

const justTcgBaseUrl = "https://api.justtcg.com/v1";

type JustTcgCard = {
  id: string;
  name: string;
  game: string;
  set: string;
  set_name: string | null;
  number: string | null;
  rarity: string | null;
  variants?: JustTcgVariant[];
};

type JustTcgVariant = {
  id: string;
  condition: string | null;
  printing: string | null;
  language: string | null;
  price: number | string | null;
  lastUpdated?: number;
};

type JustTcgListResponse = {
  data?: JustTcgCard[];
  meta?: {
    hasMore?: boolean;
    limit?: number;
    offset?: number;
    total?: number;
  };
  error?: string;
  message?: string;
};

export type JustTcgPricingCandidateWithPayload = JustTcgPricingCandidate & {
  rawPayload: {
    card: JustTcgCard;
    variant: JustTcgVariant;
  };
};

export type JustTcgPricingLookupResult =
  | {
      status: "match";
      candidate: JustTcgPricingCandidateWithPayload;
      candidates: JustTcgPricingCandidateWithPayload[];
    }
  | {
      status: "needs-review";
      candidates: JustTcgPricingCandidateWithPayload[];
      message: string;
    };

export async function lookupJustTcgPricing({
  apiKey,
  item
}: {
  apiKey: string;
  item: InventoryItem;
}): Promise<JustTcgPricingLookupResult> {
  if (!apiKey) {
    throw new Error("JUSTTCG_API_KEY is not configured.");
  }

  const cards = await searchJustTcgCards({ apiKey, item });
  const candidates = cards
    .flatMap((card) => candidateFromCard(item, card))
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  if (candidates.length === 0) {
    return {
      status: "needs-review",
      candidates: [],
      message: "JustTCG did not return priced raw-card matches."
    };
  }

  const [best, nextBest] = candidates;

  if (best && isConfidentAutoMatch(best, nextBest)) {
    return {
      status: "match",
      candidate: best,
      candidates
    };
  }

  return {
    status: "needs-review",
    candidates,
    message: "Choose the best JustTCG match before saving a market price."
  };
}

export async function findJustTcgPricingCandidateByIds({
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
  const cards = await searchJustTcgCards({ apiKey, item });
  return cards
    .flatMap((card) => candidateFromCard(item, card))
    .find(
      (candidate) =>
        candidate.sourceCardId === sourceCardId && candidate.sourceVariantId === sourceVariantId
    );
}

async function searchJustTcgCards({ apiKey, item }: { apiKey: string; item: InventoryItem }) {
  const game = item.card.language === "ja" ? "pokemon-japan" : "pokemon";
  const cardsById = new Map<string, JustTcgCard>();
  const queries = buildSearchQueries(item);

  for (const [index, query] of queries.entries()) {
    const { cards } = await fetchJustTcgCards({ apiKey, game, query, offset: 0 });

    for (const card of cards) {
      cardsById.set(card.id, card);
    }

    if (index < queries.length - 1) {
      const candidates = Array.from(cardsById.values())
        .flatMap((card) => candidateFromCard(item, card))
        .sort((left, right) => right.score - left.score);
      const [best, nextBest] = candidates;

      if (best && isConfidentAutoMatch(best, nextBest)) {
        break;
      }
    }
  }

  const [best, nextBest] = rankedCandidates(item, Array.from(cardsById.values()));

  if (best && isConfidentAutoMatch(best, nextBest)) {
    return Array.from(cardsById.values());
  }

  const broadQuery = item.card.name;
  let offset = 10;
  let hasMore = true;

  while (hasMore && offset <= 20) {
    const page = await fetchJustTcgCards({ apiKey, game, query: broadQuery, offset });

    for (const card of page.cards) {
      cardsById.set(card.id, card);
    }

    const [pageBest, pageNextBest] = rankedCandidates(item, Array.from(cardsById.values()));

    if (pageBest && isConfidentAutoMatch(pageBest, pageNextBest)) {
      break;
    }

    hasMore = page.hasMore;
    offset += 10;
  }

  return Array.from(cardsById.values());
}

async function fetchJustTcgCards({
  apiKey,
  game,
  query,
  offset
}: {
  apiKey: string;
  game: string;
  query: string;
  offset: number;
}) {
  const params = new URLSearchParams({
    game,
    q: query,
    limit: "10",
    offset: String(offset)
  });
  const response = await fetch(`${justTcgBaseUrl}/cards?${params}`, {
    headers: {
      accept: "application/json",
      "x-api-key": apiKey
    }
  });
  const payload = (await response.json().catch(() => ({}))) as JustTcgListResponse;

  if (response.status === 429) {
    throw new Error("JustTCG rate limit reached. Try again in a minute.");
  }

  if (!response.ok) {
    throw new Error(payload.error ?? payload.message ?? `JustTCG returned ${response.status}.`);
  }

  return {
    cards: Array.isArray(payload.data) ? payload.data : [],
    hasMore: Boolean(payload.meta?.hasMore)
  };
}

function buildSearchQueries(item: InventoryItem) {
  const queries = [
    [item.card.name, item.card.setName].filter(Boolean).join(" "),
    [item.card.name, normalizeCardNumber(item.card.cardNumber)].filter(Boolean).join(" "),
    [item.card.name, item.card.cardNumber].filter(Boolean).join(" "),
    item.card.name
  ];
  const seen = new Set<string>();

  return queries.filter((query) => {
    const normalizedQuery = normalizeText(query);

    if (!normalizedQuery || seen.has(normalizedQuery)) {
      return false;
    }

    seen.add(normalizedQuery);
    return true;
  });
}

function candidateFromCard(
  item: InventoryItem,
  card: JustTcgCard
): JustTcgPricingCandidateWithPayload[] {
  const variants = Array.isArray(card.variants) ? card.variants : [];
  const pricedVariants = variants
    .map((variant) => ({
      variant,
      priceCents: priceToCents(variant.price),
      score: variantScore(item, variant)
    }))
    .filter(
      (
        pricedVariant
      ): pricedVariant is { variant: JustTcgVariant; priceCents: number; score: number } =>
        pricedVariant.priceCents !== null
    )
    .sort((left, right) => right.score - left.score);
  const bestVariant = pricedVariants[0];

  if (!bestVariant) {
    return [];
  }

  const cardScore = scoreCard(item, card);
  const score = cardScore + bestVariant.score;
  const confidence = confidenceFromScore(score);

  return [
    {
      sourceCardId: card.id,
      sourceVariantId: bestVariant.variant.id,
      matchedName: card.name,
      matchedSetName: card.set_name ?? null,
      matchedCardNumber: card.number ?? null,
      condition: bestVariant.variant.condition ?? null,
      printing: bestVariant.variant.printing ?? null,
      language: bestVariant.variant.language ?? null,
      priceCents: bestVariant.priceCents,
      currency: "USD",
      confidence,
      score,
      rawPayload: {
        card,
        variant: bestVariant.variant
      }
    }
  ];
}

function rankedCandidates(item: InventoryItem, cards: JustTcgCard[]) {
  return cards
    .flatMap((card) => candidateFromCard(item, card))
    .sort((left, right) => right.score - left.score);
}

function scoreCard(item: InventoryItem, card: JustTcgCard) {
  let score = 0;
  const itemName = normalizeText(item.card.name);
  const cardName = normalizeText(card.name);
  const itemNumber = normalizeCardNumber(item.card.cardNumber);
  const cardNumber = normalizeCardNumber(card.number);
  const itemSetName = normalizeText(item.card.setName);
  const cardSetName = normalizeText(card.set_name);
  const itemSetCode = normalizeText(item.card.setCode);
  const sourceSetCode = normalizeText(card.set);

  if (cardName === itemName) {
    score += 5;
  } else if (cardName.includes(itemName) || itemName.includes(cardName)) {
    score += 2;
  }

  if (itemNumber && cardNumber === itemNumber) {
    score += 6;
  } else if (itemNumber && cardNumber) {
    score -= 3;
  } else if (itemNumber) {
    score -= 2;
  }

  if (itemSetName && cardSetName.includes(itemSetName)) {
    score += 4;
  } else if (itemSetName && sharesMeaningfulSetToken(itemSetName, cardSetName)) {
    score += 2;
  } else if (itemSetName) {
    score -= 2;
  }

  if (itemSetCode && sourceSetCode.includes(itemSetCode)) {
    score += 1;
  }

  return score;
}

function variantScore(item: InventoryItem, variant: JustTcgVariant) {
  let score = 0;
  const desiredCondition = normalizeCondition(item.conditionLabel);
  const variantCondition = normalizeCondition(variant.condition);
  const variantPrinting = normalizeText(variant.printing);
  const variantLanguage = normalizeText(variant.language);
  const itemVariants = normalizeText(item.variantDetails);
  const wantsFirstEdition = itemVariants.includes("1st edition");
  const isFirstEdition = variantPrinting.includes("1st edition");
  const isUnlimitedOrNormal =
    variantPrinting.includes("unlimited") || variantPrinting === "normal";

  if (desiredCondition && variantCondition === desiredCondition) {
    score += 3;
  } else if (!desiredCondition && variantCondition === "near mint") {
    score += 2;
  }

  if (item.card.language === "ja" && variantLanguage.includes("japanese")) {
    score += 1;
  }

  if (item.card.language === "en" && variantLanguage.includes("english")) {
    score += 1;
  }

  if (itemVariants.includes("reverse") && variantPrinting.includes("reverse")) {
    score += 2;
  } else if (
    (itemVariants.includes("holo") || itemVariants.includes("foil")) &&
    variantPrinting.includes("holo")
  ) {
    score += 2;
  } else if (!itemVariants.includes("reverse") && isUnlimitedOrNormal) {
    score += 1;
  }

  if (wantsFirstEdition && isFirstEdition) {
    score += 3;
  } else if (!wantsFirstEdition && isFirstEdition) {
    score -= 4;
  } else if (!wantsFirstEdition && isUnlimitedOrNormal) {
    score += 2;
  }

  return score;
}

function isConfidentAutoMatch(
  best: JustTcgPricingCandidateWithPayload,
  nextBest: JustTcgPricingCandidateWithPayload | undefined
) {
  return best.score >= 10 && (!nextBest || best.score - nextBest.score >= 3);
}

function confidenceFromScore(score: number): MarketPriceConfidence {
  if (score >= 10) {
    return "exact";
  }

  if (score >= 7) {
    return "strong";
  }

  return "possible";
}

function priceToCents(value: number | string | null | undefined) {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? Math.round(price * 100) : null;
}

function normalizeCondition(value: string | null | undefined) {
  return normalizeText(value).replace("lightly played", "lightly played");
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCardNumber(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .split("/")
    .map((part) => part.replace(/^0+(?=\d)/, ""))
    .join("/");
}

function sharesMeaningfulSetToken(left: string, right: string) {
  const ignored = new Set(["pokemon", "card", "the", "set", "base", "sm", "xy", "swsh"]);
  const leftTokens = left.split(" ").filter((token) => token.length > 2 && !ignored.has(token));
  const rightTokens = new Set(right.split(" "));

  return leftTokens.some((token) => rightTokens.has(token));
}
