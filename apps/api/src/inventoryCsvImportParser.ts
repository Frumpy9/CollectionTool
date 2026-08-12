import type { CreateInventoryItemRequest } from "@collection-tool/shared";

export const MAX_CSV_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_IMPORT_ROWS = 5_000;
export const MAX_CSV_IMPORT_COLUMNS = 128;
const MAX_CSV_FIELD_CHARACTERS = 250_000;

export type ParsedCsvImportRow = {
  index: number;
  lineNumber: number;
  name: string;
  payload: CreateInventoryItemRequest;
  errors: string[];
};

export function parseInventoryCsvImport(value: string): ParsedCsvImportRow[] {
  if (Buffer.byteLength(value, "utf8") > MAX_CSV_IMPORT_BYTES) {
    throw new Error("CSV files must be 5 MB or smaller.");
  }

  const records = parseCsvRecords(value).filter((record) =>
    record.cells.some((cell) => cell.trim().length > 0)
  );

  if (records.length === 0) {
    return [];
  }

  if (records.length - 1 > MAX_CSV_IMPORT_ROWS) {
    throw new Error(`CSV files may contain at most ${MAX_CSV_IMPORT_ROWS} data rows.`);
  }

  if (records[0].cells.length > MAX_CSV_IMPORT_COLUMNS) {
    throw new Error(`CSV files may contain at most ${MAX_CSV_IMPORT_COLUMNS} columns.`);
  }

  const headers = records[0].cells.map(normalizeCsvHeader);
  const seenHeaders = new Set<string>();

  for (const header of headers) {
    if (!header) {
      continue;
    }

    if (seenHeaders.has(header)) {
      throw new Error(`CSV has duplicate column "${header}".`);
    }

    seenHeaders.add(header);
  }

  return records.slice(1).map((record, index) =>
    createCsvImportRow(index, headers, record)
  );
}

function createCsvImportRow(
  index: number,
  headers: string[],
  record: { cells: string[]; lineNumber: number }
): ParsedCsvImportRow {
  const raw = headers.reduce<Record<string, string>>((row, header, cellIndex) => {
    if (header) {
      row[header] = record.cells[cellIndex]?.trim() ?? "";
    }

    return row;
  }, {});

  if (isPsaVaultCsvRow(raw)) {
    return createPsaVaultCsvImportRow(index, raw, record);
  }

  const itemType = csvItemType(csvValue(raw, "item_type", "type"));
  const language = csvLanguage(csvValue(raw, "language", "lang"));
  const payload: CreateInventoryItemRequest = {
    name: csvValue(raw, "name", "card_name"),
    setName: csvValue(raw, "set_name"),
    setCode: csvValue(raw, "set_code"),
    cardNumber: csvValue(raw, "card_number", "number"),
    language,
    rarity: csvValue(raw, "rarity"),
    imageUrl: csvValue(raw, "image_url"),
    itemType,
    quantity: csvInteger(csvValue(raw, "quantity", "qty"), 1),
    conditionLabel: csvValue(raw, "condition_label", "condition"),
    conditionScore: csvOptionalNumber(csvValue(raw, "condition_score", "score")),
    variantDetails: csvValue(raw, "variant_details", "variants"),
    grader: itemType === "graded" ? csvValue(raw, "grader") : "",
    grade: itemType === "graded" ? csvValue(raw, "grade") : "",
    certNumber: itemType === "graded" ? csvValue(raw, "cert_number", "cert") : "",
    certUrl: csvValue(raw, "cert_url"),
    certSpecId: csvValue(raw, "cert_spec_id"),
    certCategory: csvValue(raw, "cert_category"),
    certPopulation: csvValue(raw, "cert_population"),
    certPopulationHigher: csvValue(raw, "cert_population_higher"),
    certEstimateCents: csvOptionalCents(csvValue(raw, "cert_estimate_cents")),
    certLookupAt: csvValue(raw, "cert_lookup_at"),
    purchasePriceCents: csvOptionalCents(
      csvValue(raw, "purchase_price_cents"),
      csvValue(raw, "purchase_price", "purchase")
    ),
    purchaseDate: csvValue(raw, "purchase_date"),
    valueOverrideCents: csvOptionalCents(
      csvValue(raw, "value_override_cents"),
      csvValue(raw, "value_override", "value")
    ),
    storageLocation: csvValue(raw, "storage_location", "storage"),
    notes: csvValue(raw, "notes")
  };

  return {
    index,
    lineNumber: record.lineNumber,
    name: payload.name,
    payload,
    errors: validateCsvImportPayload(payload, raw, record.cells.length > headers.length)
  };
}

function createPsaVaultCsvImportRow(
  index: number,
  raw: Record<string, string>,
  record: { cells: string[]; lineNumber: number }
): ParsedCsvImportRow {
  const setName = csvPlaceholderValue(raw, "set");
  const normalizedSetName = normalizePsaVaultSetName(setName);
  const subject = csvPlaceholderValue(raw, "subject");
  const variety = csvPlaceholderValue(raw, "variety");
  const itemDescription = csvPlaceholderValue(raw, "item");
  const parsedName = parsePsaVaultCardName(subject || nameFromPsaVaultItem(itemDescription));
  const certNumber = csvPlaceholderValue(raw, "cert_number");
  const grader = csvPlaceholderValue(raw, "grade_issuer") || "PSA";
  const vaultStatus = csvPlaceholderValue(raw, "vault_status");
  const notes = [
    csvPlaceholderValue(raw, "my_notes"),
    vaultStatus ? `Vault status: ${vaultStatus}` : "",
    csvPlaceholderValue(raw, "vaulted_date")
      ? `Vaulted date: ${csvPlaceholderValue(raw, "vaulted_date")}`
      : "",
    csvPlaceholderValue(raw, "source")
      ? `Source: ${csvPlaceholderValue(raw, "source")}`
      : "",
    csvPlaceholderValue(raw, "listing_status")
      ? `Listing status: ${csvPlaceholderValue(raw, "listing_status")}`
      : "",
    csvPlaceholderValue(raw, "sold_status")
      ? `Sold status: ${csvPlaceholderValue(raw, "sold_status")}`
      : "",
    itemDescription ? `PSA Vault item: ${itemDescription}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  const payload: CreateInventoryItemRequest = {
    name: parsedName.name,
    setName: normalizedSetName,
    setCode: setCodeFromPsaVaultSet(setName),
    cardNumber: csvPlaceholderValue(raw, "card_number"),
    language: psaVaultLanguage(setName, itemDescription),
    rarity: "",
    releaseYear: csvPlaceholderValue(raw, "year"),
    imageUrl: "",
    itemType: "graded",
    quantity: 1,
    conditionLabel: "",
    variantDetails: psaVaultVariantDetails(variety, parsedName.variant, normalizedSetName),
    grader,
    grade: csvPlaceholderValue(raw, "grade"),
    certNumber,
    certUrl: certNumber ? `https://www.psacard.com/cert/${certNumber}/psa` : "",
    certSpecId: "",
    certCategory: titleCaseSetName(csvPlaceholderValue(raw, "category")),
    certPopulation: "",
    certPopulationHigher: "",
    certEstimateCents: csvOptionalCents("", csvPlaceholderValue(raw, "psa_estimate")),
    certLookupAt: "",
    purchasePriceCents: csvOptionalCents("", csvPlaceholderValue(raw, "my_cost")),
    purchaseDate: normalizeCsvDate(csvPlaceholderValue(raw, "date_acquired")),
    valueOverrideCents: csvOptionalCents("", csvPlaceholderValue(raw, "my_value")),
    storageLocation: vaultStatus,
    notes
  };

  return {
    index,
    lineNumber: record.lineNumber,
    name: payload.name,
    payload,
    errors: validateCsvImportPayload(payload, raw, record.cells.length > Object.keys(raw).length)
  };
}

function validateCsvImportPayload(
  payload: CreateInventoryItemRequest,
  raw: Record<string, string>,
  hasExtraCells: boolean
) {
  const errors: string[] = [];
  const rawLanguage = csvValue(raw, "language", "lang").toLowerCase();
  const rawItemType = csvValue(raw, "item_type", "type").toLowerCase();
  const rawQuantity = csvValue(raw, "quantity", "qty");

  if (hasExtraCells) errors.push("Row has more values than the header row.");
  if (!payload.name.trim() || payload.name.trim().length < 2) {
    errors.push("Card name must be at least 2 characters.");
  }
  if (rawLanguage && !["en", "english", "ja", "japanese", "other"].includes(rawLanguage)) {
    errors.push("Language must be en, ja, or other.");
  }
  if (rawItemType && !["raw", "graded"].includes(rawItemType)) {
    errors.push("Item type must be raw or graded.");
  }
  if (
    (rawQuantity && !Number.isInteger(Number(rawQuantity))) ||
    !Number.isInteger(payload.quantity) ||
    payload.quantity < 1 ||
    payload.quantity > 999
  ) {
    errors.push("Quantity must be between 1 and 999.");
  }
  if (
    payload.conditionScore !== undefined &&
    (!Number.isFinite(payload.conditionScore) ||
      payload.conditionScore < 1 ||
      payload.conditionScore > 10)
  ) {
    errors.push("Condition score must be between 1 and 10.");
  }
  if (payload.itemType === "graded" && !payload.grader?.trim()) {
    errors.push("Graded rows need a grader.");
  }
  if (!isValidOptionalCents(payload.purchasePriceCents)) {
    errors.push("Purchase price must be a positive amount.");
  }
  if (!isValidOptionalCents(payload.valueOverrideCents)) {
    errors.push("Value override must be a positive amount.");
  }
  if (!isValidOptionalCents(payload.certEstimateCents)) {
    errors.push("Cert estimate must be a positive amount.");
  }

  return errors;
}

function parseCsvRecords(value: string) {
  const records: Array<{ cells: string[]; lineNumber: number }> = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let lineNumber = 1;
  let rowLineNumber = 1;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
        if (cell.length > MAX_CSV_FIELD_CHARACTERS) {
          throw new Error("CSV fields may contain at most 250,000 characters.");
        }
        if (char === "\n") lineNumber += 1;
      }
      continue;
    }

    if (char === '"' && cell.length === 0) {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
      if (cells.length > MAX_CSV_IMPORT_COLUMNS) {
        throw new Error(`CSV files may contain at most ${MAX_CSV_IMPORT_COLUMNS} columns.`);
      }
    } else if (char === "\n" || char === "\r") {
      cells.push(cell);
      records.push({ cells, lineNumber: rowLineNumber });
      if (records.length > MAX_CSV_IMPORT_ROWS + 1) {
        throw new Error(`CSV files may contain at most ${MAX_CSV_IMPORT_ROWS} data rows.`);
      }
      cells = [];
      cell = "";
      if (char === "\r" && next === "\n") index += 1;
      lineNumber += 1;
      rowLineNumber = lineNumber;
    } else {
      cell += char;
      if (cell.length > MAX_CSV_FIELD_CHARACTERS) {
        throw new Error("CSV fields may contain at most 250,000 characters.");
      }
    }
  }

  if (inQuotes) throw new Error("CSV has an unclosed quoted field.");
  if (cell.length > 0 || cells.length > 0) {
    cells.push(cell);
    records.push({ cells, lineNumber: rowLineNumber });
  }
  return records;
}

function isPsaVaultCsvRow(raw: Record<string, string>) {
  return Boolean(
    raw.item_status !== undefined &&
      raw.cert_number !== undefined &&
      raw.grade_issuer !== undefined &&
      raw.psa_estimate !== undefined &&
      raw.vault_status !== undefined
  );
}

function csvValue(raw: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = raw[normalizeCsvHeader(key)];
    if (value) return value.trim();
  }
  return "";
}

function csvPlaceholderValue(raw: Record<string, string>, ...keys: string[]) {
  const value = csvValue(raw, ...keys);
  return value === "-" ? "" : value;
}

function normalizeCsvHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function csvLanguage(value: string): "en" | "ja" | "other" {
  const language = value.trim().toLowerCase();
  if (language === "ja" || language === "japanese") return "ja";
  if (language === "other") return "other";
  return "en";
}

function csvItemType(value: string): "raw" | "graded" {
  return value.trim().toLowerCase() === "graded" ? "graded" : "raw";
}

function csvInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function csvOptionalNumber(value: string) {
  return value.trim() ? Number(value) : undefined;
}

function csvOptionalCents(centsValue: string, moneyValue = "") {
  if (centsValue.trim()) return Number(centsValue);
  if (!moneyValue.trim()) return undefined;
  return Math.round(Number(moneyValue.replace(/[$,]/g, "")) * 100);
}

function isValidOptionalCents(value: number | undefined) {
  return value === undefined || (Number.isInteger(value) && value >= 0);
}

function normalizeCsvDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!match) return trimmed;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function psaVaultLanguage(setName: string, itemDescription: string): "en" | "ja" {
  return `${setName} ${itemDescription}`.toLowerCase().includes("japanese") ? "ja" : "en";
}

function normalizePsaVaultSetName(value: string) {
  const rawName = value.replace(/\s+/g, " ").trim();
  const normalized = normalizeText(rawName);
  const explicitNames: Record<string, string> = {
    "pokemon jtg en-journey together": "Journey Together",
    "pokemon mew en-151": "151",
    "pokemon pre en-prismatic evolutions": "Prismatic Evolutions",
    "pokemon pop series 2": "POP Series 2",
    "pokemon rocket": "Team Rocket",
    "pokemon sun & moon forbidden light": "Forbidden Light",
    "pokemon japanese m1l-mega brave": "Mega Brave (M1L)",
    "pokemon japanese m2a-mega dream ex": "Mega Dream ex (M2a)",
    "pokemon japanese sv-p promo": "SV-P Promotional Cards",
    "pokemon japanese s promo": "S Promotional Cards",
    "pokemon japanese promo": "Japanese Promo",
    "pokemon japanese e-starter deck": "Japanese E-Starter Deck",
    "pokemon japanese vending": "Japanese Vending",
    "pokemon japanese neo 4": "Japanese Neo 4"
  };
  if (explicitNames[normalized]) return explicitNames[normalized];
  const japaneseCodeMatch = /^pokemon japanese ([a-z0-9]+)-(.+)$/i.exec(rawName);
  if (japaneseCodeMatch) {
    return `${titleCaseSetName(japaneseCodeMatch[2])} (${japaneseCodeMatch[1].toUpperCase()})`;
  }
  const englishCodeMatch = /^pokemon [a-z0-9]+ en-(.+)$/i.exec(rawName);
  if (englishCodeMatch) return titleCaseSetName(englishCodeMatch[1]);
  return titleCaseSetName(rawName.replace(/^pokemon\s+/i, ""));
}

function setCodeFromPsaVaultSet(setName: string) {
  const ignored = new Set(["POKEMON", "JAPANESE", "PROMO"]);
  const match = setName
    .toUpperCase()
    .match(/\b[A-Z]{1,5}\d{0,3}[A-Z]?(?:-[A-Z0-9]+)?\b/g)
    ?.find((token) => !ignored.has(token));
  return match ? /^(SV\d+|M\d[A-Z])/i.exec(match)?.[0] ?? match : "";
}

function nameFromPsaVaultItem(itemDescription: string) {
  const hashIndex = itemDescription.indexOf("#");
  if (hashIndex === -1) return itemDescription;
  return itemDescription
    .slice(hashIndex)
    .replace(/^#\S+\s+/, "")
    .replace(/\s+[A-Z0-9-]+(?:'S)?(?:\s+[A-Z0-9-]+)*$/, "")
    .trim();
}

function parsePsaVaultCardName(value: string) {
  const rawName = value.replace(/\s+/g, " ").trim();
  const slashParts = rawName.split(/\s*\/\s*/);
  const variants: string[] = [];
  let name = rawName;
  if (slashParts.length >= 2 && isPsaVaultLeadingVariant(slashParts[0])) {
    variants.push(slashParts[0]);
    name = slashParts.slice(1).join("/");
  }
  const trailingVariant = psaVaultTrailingVariant(name);
  if (trailingVariant) {
    variants.push(trailingVariant.variant);
    name = trailingVariant.name;
  }
  return { name: titleCaseCardName(name), variant: csvVariantDetails(...variants) };
}

function isPsaVaultLeadingVariant(value: string) {
  return [
    "alternate art",
    "full art",
    "hyper rare",
    "illustration rare",
    "secret rare",
    "special art",
    "special illustration rare"
  ].includes(normalizeText(value));
}

function psaVaultTrailingVariant(value: string) {
  const match = /\s*[-–—]\s*(reverse holo|reverse foil|holo|foil)\s*$/i.exec(value);
  if (!match || match.index === undefined) return null;
  const name = value.slice(0, match.index).trim();
  const variant = normalizeText(match[1]).includes("reverse") ? "Reverse Holo" : "Holo / Foil";
  return name ? { name, variant } : null;
}

function csvVariantDetails(...values: string[]) {
  return uniqueNonEmptyStrings(values.map(titleCaseVariant)).join(", ");
}

function psaVaultVariantDetails(variety: string, parsedVariant: string, setName: string) {
  return csvVariantDetails(...psaVaultVarietyParts(variety, setName), parsedVariant);
}

function psaVaultVarietyParts(value: string, setName: string) {
  const normalizedSet = normalizeText(setName);
  const setTokens = normalizedSet.replace(/\([^)]*\)/g, " ").split(" ").filter((token) => token.length > 1);
  return value
    .split(/\s*-\s*/)
    .map(normalizePsaVaultVarietyPart)
    .filter((part) => {
      const normalizedPart = normalizeText(part);
      return normalizedPart && normalizedPart !== normalizedSet &&
        !(setTokens.length > 0 && setTokens.every((token) => normalizedPart.includes(token)));
    });
}

function normalizePsaVaultVarietyPart(value: string) {
  const known: Record<string, string> = {
    "f.a.": "Full Art",
    fa: "Full Art",
    "full art": "Full Art",
    "illustration rare": "Illustration Rare",
    "special illustration rare": "Special Illustration Rare",
    "special art rare": "Special Art Rare",
    "mega attack rare": "Mega Attack Rare",
    "art rare": "Art Rare",
    "toys r us": "Toys R Us",
    "mcdonald's": "McDonald's",
    "hif elite trainer box": "Elite Trainer Box"
  };
  return known[normalizeText(value)] ?? titleCaseVariant(value);
}

function titleCaseSetName(value: string) {
  return titleCaseWords(value.replace(/\s+/g, " ").trim());
}

function titleCaseCardName(value: string) {
  return titleCaseWords(
    value
      .replace(/\s+-\s+\S+\/\S+\s*$/i, "")
      .replace(/\s*-\s*(ex|gx|v|vmax|vstar)\b/gi, " $1")
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function titleCaseVariant(value: string) {
  return titleCaseWords(value.replace(/\s+/g, " ").trim());
}

function titleCaseWords(value: string) {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
    .replace(/\b(Gx|Ex|Vmax|Vstar|V|Lv|Pc|Xy|Sv|Dp|Mcdonald'S)\b/g, (word) =>
      word === "Mcdonald'S" ? "McDonald's" : word.toUpperCase()
    )
    .replace(/'S\b/g, "'s")
    .replace(/-([a-z])/g, (_, letter: string) => `-${letter.toUpperCase()}`);
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueNonEmptyStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const trimmed = value.trim();
    const key = normalizeText(trimmed);
    if (!trimmed || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
