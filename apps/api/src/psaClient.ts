import type { CreateInventoryItemRequest, PsaCertLookupResponse } from "@collection-tool/shared";

const psaBaseUrl = "https://api.psacard.com/publicapi";

type PsaLookupOptions = {
  accessToken: string;
  pokemonTcgApiKey: string;
  certNumber: string;
};

type PokemonTcgCard = {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set?: {
    name?: string;
  };
  images?: {
    small?: string;
    large?: string;
  };
};

export async function lookupPsaCert({
  accessToken,
  pokemonTcgApiKey,
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
    pokemonTcgApiKey
  ).catch(() => null);

  if (!pokemonCard) {
    return normalized;
  }

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
  const imageUrl = stringify(findValue(payload, ["ImageURL", "ImageUrl", "imageUrl", "Image"]));
  const certFromPayload =
    stringify(findValue(payload, ["CertNumber", "CertNo", "certNumber", "certNo"])) ?? certNumber;
  const name = buildCardName({ year, brand, subject, variety });

  const item: CreateInventoryItemRequest = {
    name: name || `PSA Cert ${certFromPayload}`,
    setName: brand ?? undefined,
    cardNumber: cardNumber ?? undefined,
    language: "en",
    imageUrl: imageUrl ?? undefined,
    itemType: "graded",
    quantity: 1,
    grader: "PSA",
    grade: grade ?? undefined,
    certNumber: certFromPayload,
    variantDetails: variety ?? undefined,
    notes: specId ? `PSA Spec ID: ${specId}` : undefined
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
      populationHigher: populationHigher ?? null
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
      populationHigher: null
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

async function lookupPokemonTcgCard(cardNumber: string, apiKey: string) {
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
  return payload.data?.[0] ?? null;
}
