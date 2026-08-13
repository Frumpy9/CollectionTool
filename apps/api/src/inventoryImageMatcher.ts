import type {
  CardImageLookupCandidate,
  CardImageLookupResponse,
  CardImageMatchReason,
  CardLanguage,
  CardLookupCandidate,
  CreateInventoryItemRequest,
  InventoryItem
} from "@collection-tool/shared";
import { lookupCards } from "./cardLookupClient.js";
import type { AppDatabase } from "./db.js";
import { lookupPokemonPriceTrackerImageCandidates } from "./pokemonPriceTrackerClient.js";

export type InventoryImageLookupHit = {
  candidate: CardLookupCandidate;
  query: string;
};

export type InventoryImageLookupOptions = {
  item: InventoryItem;
  pokemonTcgApiKey: string;
  pokemonPriceTrackerApiKey: string;
  database: AppDatabase;
  preferredPokemonPriceTrackerCardId?: string | null;
};

export async function lookupInventoryImageCandidates({
  item,
  pokemonTcgApiKey,
  pokemonPriceTrackerApiKey,
  database,
  preferredPokemonPriceTrackerCardId
}: InventoryImageLookupOptions): Promise<CardImageLookupResponse> {
  const payload = inventoryItemToImagePayload(item);
  const attempts: CardImageLookupResponse["attempts"] = [];

  try {
    const candidates = await lookupPokemonPriceTrackerImageCandidates({
      apiKey: pokemonPriceTrackerApiKey,
      item,
      preferredSourceCardId: preferredPokemonPriceTrackerCardId
    });
    const ranked = rankInventoryImageCandidates(
      payload,
      candidates.map((candidate) => ({
        candidate,
        query: preferredPokemonPriceTrackerCardId
          ? `PokemonPriceTracker card ${preferredPokemonPriceTrackerCardId}`
          : "PokemonPriceTracker inventory match"
      }))
    );

    if (ranked.length > 0) {
      attempts.push({
        provider: "pokemonpricetracker",
        status: "matched",
        message: `Found ${ranked.length} ranked PokemonPriceTracker image option${ranked.length === 1 ? "" : "s"}.`
      });
      return {
        candidates: ranked,
        attempts,
        message: attempts[0].message
      };
    }

    attempts.push({
      provider: "pokemonpricetracker",
      status: "empty",
      message: "PokemonPriceTracker did not return a compatible image."
    });
  } catch (error) {
    attempts.push({
      provider: "pokemonpricetracker",
      status: "unavailable",
      message: friendlyProviderMessage(error, "PokemonPriceTracker image lookup was unavailable.")
    });
  }

  const genericHits: InventoryImageLookupHit[] = [];
  const queries = inventoryImageLookupQueries(payload);
  const languages: Array<CardLanguage | "all"> =
    payload.language === "other" ? ["all"] : [payload.language, "all"];

  for (const query of queries) {
    for (const language of [...new Set(languages)]) {
      try {
        const result = await lookupCards({
          query,
          language,
          pokemonTcgApiKey,
          pokemonPriceTrackerApiKey,
          database
        });
        genericHits.push(
          ...result.candidates.map((candidate) => ({ candidate, query }))
        );
      } catch {
        // Individual provider failures are already isolated inside card lookup. A failed query
        // should not discard compatible candidates returned by the other queries.
      }
    }
  }

  const candidates = rankInventoryImageCandidates(payload, genericHits);
  attempts.push({
    provider: "card-lookup",
    status: candidates.length > 0 ? "matched" : "empty",
    message:
      candidates.length > 0
        ? `Found ${candidates.length} ranked fallback image option${candidates.length === 1 ? "" : "s"}.`
        : "The fallback card databases did not return a compatible image."
  });

  return {
    candidates,
    attempts,
    message:
      candidates.length > 0
        ? attempts.at(-1)!.message
        : "No compatible image candidates were found."
  };
}

export function rankInventoryImageCandidates(
  payload: CreateInventoryItemRequest,
  hits: readonly InventoryImageLookupHit[]
): CardImageLookupCandidate[] {
  const byImage = new Map<
    string,
    { candidate: CardImageLookupCandidate; queries: Set<string> }
  >();

  for (const hit of hits) {
    const imageUrl = imageUrlForCandidate(hit.candidate);

    if (!imageUrl || !imageCandidateMatchesInventory(payload, hit.candidate)) {
      continue;
    }

    const reasons = imageMatchReasons(payload, hit.candidate);
    const imageMatchScore =
      hit.candidate.score + reasons.reduce((total, reason) => total + reason.scoreDelta, 0);
    const rankedCandidate: CardImageLookupCandidate = {
      ...hit.candidate,
      imageUrl,
      imageMatchScore,
      imageMatchConfidence: imageMatchConfidence(reasons, hit.candidate.confidence),
      imageMatchReasons: reasons,
      matchedQueries: [hit.query]
    };
    const existing = byImage.get(imageUrl);

    if (!existing) {
      byImage.set(imageUrl, { candidate: rankedCandidate, queries: new Set([hit.query]) });
      continue;
    }

    existing.queries.add(hit.query);
    if (imageMatchScore > existing.candidate.imageMatchScore) {
      existing.candidate = rankedCandidate;
    }
  }

  return [...byImage.values()]
    .map(({ candidate, queries }) => ({
      ...candidate,
      matchedQueries: [...queries]
    }))
    .sort(
      (left, right) =>
        right.imageMatchScore - left.imageMatchScore ||
        left.name.localeCompare(right.name) ||
        left.imageUrl.localeCompare(right.imageUrl)
    )
    .slice(0, 8);
}

export function inventoryImageLookupQueries(payload: CreateInventoryItemRequest) {
  const queries: string[] = [];

  for (const name of imageLookupNameOptions(payload.name)) {
    queries.push(
      [name, payload.setName, payload.cardNumber].filter(Boolean).join(" "),
      [name, payload.setCode, payload.cardNumber].filter(Boolean).join(" "),
      [name, payload.cardNumber].filter(Boolean).join(" "),
      [name, payload.setName].filter(Boolean).join(" ")
    );
  }

  queries.push(
    [payload.setCode, payload.cardNumber].filter(Boolean).join(" "),
    [payload.setName, payload.cardNumber].filter(Boolean).join(" ")
  );

  return uniqueNonEmptyStrings(queries);
}

export function imageCandidateMatchesInventory(
  payload: CreateInventoryItemRequest,
  candidate: CardLookupCandidate
) {
  if (
    payload.cardNumber &&
    candidate.cardNumber &&
    !cardNumbersCompatible(payload.cardNumber, candidate.cardNumber)
  ) {
    return false;
  }

  const inventoryNames = imageLookupNameOptions(payload.name)
    .map(normalizeSearchText)
    .filter(Boolean);
  const candidateNames = imageLookupNameOptions(candidate.name)
    .map(normalizeSearchText)
    .filter(Boolean);

  if (
    inventoryNames.length > 0 &&
    candidateNames.length > 0 &&
    !inventoryNames.some((inventoryName) =>
      candidateNames.some((candidateName) => namesCompatible(inventoryName, candidateName))
    )
  ) {
    return false;
  }

  if (payload.setName && candidate.setName) {
    const inventorySetName = normalizeSearchText(payload.setName);
    const candidateSetName = normalizeSearchText(candidate.setName);

    if (
      inventorySetName &&
      candidateSetName &&
      inventorySetName !== candidateSetName &&
      !inventorySetName.includes(candidateSetName) &&
      !candidateSetName.includes(inventorySetName)
    ) {
      return false;
    }
  }

  return true;
}

export function imageMatchReasons(
  payload: CreateInventoryItemRequest,
  candidate: CardLookupCandidate
): CardImageMatchReason[] {
  const inventoryNames = imageLookupNameOptions(payload.name).map(normalizeSearchText);
  const candidateName = normalizeSearchText(candidate.name);
  const nameStatus = inventoryNames.includes(candidateName)
    ? "match"
    : inventoryNames.some((name) => namesCompatible(name, candidateName))
      ? "partial"
      : "mismatch";
  const inventorySetName = normalizeSearchText(payload.setName);
  const candidateSetName = normalizeSearchText(candidate.setName);
  const setNameStatus =
    !inventorySetName || !candidateSetName
      ? "unknown"
      : inventorySetName === candidateSetName
        ? "match"
        : inventorySetName.includes(candidateSetName) || candidateSetName.includes(inventorySetName)
          ? "partial"
          : "mismatch";
  const cardNumberStatus =
    !payload.cardNumber || !candidate.cardNumber
      ? "unknown"
      : cardNumbersCompatible(payload.cardNumber, candidate.cardNumber)
        ? "match"
        : "mismatch";
  const setCodeStatus =
    !payload.setCode || !candidate.setCode
      ? "unknown"
      : normalizeText(payload.setCode) === normalizeText(candidate.setCode)
        ? "match"
        : "mismatch";
  const languageStatus = candidate.language === payload.language ? "match" : "mismatch";

  return [
    reason(
      "source-confidence",
      "Source confidence",
      candidate.confidence,
      candidate.confidence,
      candidate.confidence === "exact"
        ? "match"
        : candidate.confidence === "strong"
          ? "partial"
          : "unknown",
      candidate.confidence === "exact" ? 120 : candidate.confidence === "strong" ? 70 : 20
    ),
    reason("language", "Language", payload.language, candidate.language, languageStatus, languageStatus === "match" ? 40 : 0),
    reason("card-number", "Card number", payload.cardNumber, candidate.cardNumber, cardNumberStatus, cardNumberStatus === "match" ? 90 : 0),
    reason("set-code", "Set code", payload.setCode, candidate.setCode, setCodeStatus, setCodeStatus === "match" ? 50 : 0),
    reason(
      "set-name",
      "Set name",
      payload.setName,
      candidate.setName,
      setNameStatus,
      setNameStatus === "match" ? 50 : setNameStatus === "partial" ? 25 : 0
    ),
    reason(
      "card-name",
      "Card name",
      payload.name,
      candidate.name,
      nameStatus,
      nameStatus === "match" ? 50 : nameStatus === "partial" ? 25 : 0
    )
  ];
}

function imageMatchConfidence(
  reasons: readonly CardImageMatchReason[],
  sourceConfidence: CardLookupCandidate["confidence"]
) {
  const status = new Map(reasons.map((reason) => [reason.code, reason.status]));
  const nameMatches = status.get("card-name") === "match";
  const numberMatches = status.get("card-number") === "match";
  const setMatches =
    status.get("set-code") === "match" || status.get("set-name") === "match";

  if (nameMatches && numberMatches && setMatches) {
    return "exact" as const;
  }

  if (
    (nameMatches && (numberMatches || setMatches)) ||
    (sourceConfidence === "exact" && nameMatches)
  ) {
    return "strong" as const;
  }

  return "possible" as const;
}

function reason(
  code: CardImageMatchReason["code"],
  label: string,
  inventoryValue: unknown,
  candidateValue: unknown,
  status: CardImageMatchReason["status"],
  scoreDelta: number
): CardImageMatchReason {
  const inventory = displayValue(inventoryValue);
  const candidate = displayValue(candidateValue);
  const comparison =
    status === "match"
      ? "matches"
      : status === "partial"
        ? "partially matches"
        : status === "mismatch"
          ? "differs"
          : "could not be compared";

  return {
    code,
    label,
    status,
    inventoryValue: inventory,
    candidateValue: candidate,
    scoreDelta,
    message: `${label} ${comparison}${candidate ? ` (${candidate})` : ""}.`
  };
}

function inventoryItemToImagePayload(item: InventoryItem): CreateInventoryItemRequest {
  return {
    name: item.card.name,
    setName: item.card.setName ?? "",
    setCode: item.card.setCode ?? "",
    cardNumber: item.card.cardNumber ?? "",
    language: item.card.language,
    rarity: item.card.rarity ?? "",
    releaseYear: item.card.releaseYear ?? "",
    imageUrl: item.card.imageUrl ?? "",
    itemType: item.itemType,
    quantity: item.quantity,
    conditionLabel: item.conditionLabel ?? "",
    variantDetails: item.variantDetails ?? "",
    grader: item.grader ?? "",
    grade: item.grade ?? "",
    certNumber: item.certNumber ?? ""
  };
}

function imageUrlForCandidate(candidate: CardLookupCandidate) {
  return candidate.imageUrl?.trim() || candidate.item.imageUrl?.trim() || null;
}

function imageLookupNameOptions(name: string) {
  const trimmed = name.trim();
  const withoutPsaFinish = trimmed.replace(/\s*-\s*(holo|hologram|reverse holo)$/i, "").trim();
  return uniqueNonEmptyStrings([trimmed, withoutPsaFinish]);
}

function namesCompatible(left: string, right: string) {
  return Boolean(
    left === right ||
      (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left)))
  );
}

function cardNumbersCompatible(left: unknown, right: unknown) {
  const leftNumber = normalizeCardNumber(left);
  const rightNumber = normalizeCardNumber(right);
  const leftPrinted = leftNumber.split("/")[0];
  const rightPrinted = rightNumber.split("/")[0];

  return Boolean(
    leftNumber &&
      rightNumber &&
      (leftNumber === rightNumber || leftPrinted === rightNumber || rightPrinted === leftNumber)
  );
}

function uniqueNonEmptyStrings(values: string[]) {
  const seen = new Set<string>();
  const uniqueValues: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeText(trimmed);

    if (!trimmed || seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueValues.push(trimmed);
  }

  return uniqueValues;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeSearchText(value: unknown) {
  return normalizeText(value).replace(/[^a-z0-9\p{L}\p{N}]+/gu, " ").trim();
}

function normalizeCardNumber(value: unknown) {
  return normalizeText(value).replace(/\b0+(\d)/g, "$1");
}

function displayValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function friendlyProviderMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (/not configured/i.test(error.message)) return fallback;
  return error.message.length <= 240 ? error.message : fallback;
}
