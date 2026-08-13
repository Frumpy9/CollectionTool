import type {
  CreateInventoryItemRequest,
  InventoryDuplicateMatch,
  InventoryDuplicateMatchKind,
  InventoryDuplicateReason,
  InventoryDuplicateReasonCode,
  InventoryItem
} from "@collection-tool/shared";

export type InventoryIdentity = {
  itemType: unknown;
  language: unknown;
  name: unknown;
  setCode: unknown;
  cardNumber: unknown;
  conditionLabel: unknown;
  variantDetails: unknown;
  grader: unknown;
  grade: unknown;
  certNumber: unknown;
};

export type InventoryDuplicateGroup = {
  key: string;
  kind: InventoryDuplicateMatchKind;
  reasons: InventoryDuplicateReason[];
  items: InventoryItem[];
};

type IdentityField = {
  code: InventoryDuplicateReasonCode;
  label: string;
  normalized: string;
  display: string;
  includeWhenEmpty?: boolean;
};

export function inventoryIdentityFromItem(item: InventoryItem): InventoryIdentity {
  return {
    itemType: item.itemType,
    language: item.card.language,
    name: item.card.name,
    setCode: item.card.setCode,
    cardNumber: item.card.cardNumber,
    conditionLabel: item.conditionLabel,
    variantDetails: item.variantDetails,
    grader: item.grader,
    grade: item.grade,
    certNumber: item.certNumber
  };
}

export function inventoryIdentityFromPayload(
  payload: CreateInventoryItemRequest | Record<string, unknown>
): InventoryIdentity {
  return {
    itemType: payload.itemType,
    language: payload.language,
    name: payload.name,
    setCode: payload.setCode,
    cardNumber: payload.cardNumber,
    conditionLabel: payload.conditionLabel,
    variantDetails: payload.variantDetails,
    grader: payload.grader,
    grade: payload.grade,
    certNumber: payload.certNumber
  };
}

export function inventoryDuplicateIdentityKey(identity: InventoryIdentity) {
  return identityFields(identity).map((field) => field.normalized).join("|");
}

export function normalizedInventoryCertNumber(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function exactInventoryDuplicateReasons(
  identity: InventoryIdentity
): InventoryDuplicateReason[] {
  return identityFields(identity)
    .filter((field) => field.includeWhenEmpty || field.normalized)
    .map(toReason);
}

export function certInventoryDuplicateReasons(
  identity: InventoryIdentity
): InventoryDuplicateReason[] {
  const certField = identityFields(identity).find((field) => field.code === "cert-number")!;
  return certField.normalized ? [toReason(certField)] : [];
}

export function findInventoryDuplicateMatches(
  items: readonly InventoryItem[],
  payload: CreateInventoryItemRequest
): InventoryDuplicateMatch[] {
  const candidate = inventoryIdentityFromPayload(payload);
  const certNumber = normalizedInventoryCertNumber(candidate.certNumber);

  if (certNumber) {
    const certMatches = items.filter(
      (item) =>
        normalizedInventoryCertNumber(inventoryIdentityFromItem(item).certNumber) === certNumber
    );

    if (certMatches.length > 0) {
      return certMatches.map((item) => ({
        item,
        kind: "cert-number",
        reasons: certInventoryDuplicateReasons(candidate),
        mergeAllowed: false,
        separateAllowed: false
      }));
    }
  }

  if (!normalizeText(candidate.name)) {
    return [];
  }

  const key = inventoryDuplicateIdentityKey(candidate);
  const reasons = exactInventoryDuplicateReasons(candidate);

  return items
    .filter((item) => inventoryDuplicateIdentityKey(inventoryIdentityFromItem(item)) === key)
    .map((item) => ({
      item,
      kind: "exact-identity",
      reasons,
      mergeAllowed: true,
      separateAllowed: true
    }));
}

export function groupInventoryDuplicates(
  items: readonly InventoryItem[]
): InventoryDuplicateGroup[] {
  const groups: InventoryDuplicateGroup[] = [];
  const duplicateCertItemIds = new Set<string>();
  const byCert = groupBy(items, (item) =>
    normalizedInventoryCertNumber(inventoryIdentityFromItem(item).certNumber)
  );

  for (const [certNumber, group] of byCert) {
    if (!certNumber || group.length < 2) continue;
    group.forEach((item) => duplicateCertItemIds.add(item.id));
    groups.push({
      key: certNumber,
      kind: "cert-number",
      reasons: certInventoryDuplicateReasons(inventoryIdentityFromItem(group[0])),
      items: group
    });
  }

  const byIdentity = groupBy(items, (item) =>
    inventoryDuplicateIdentityKey(inventoryIdentityFromItem(item))
  );

  for (const [key, group] of byIdentity) {
    if (
      !key ||
      group.length < 2 ||
      group.some((item) => duplicateCertItemIds.has(item.id))
    ) {
      continue;
    }
    groups.push({
      key,
      kind: "exact-identity",
      reasons: exactInventoryDuplicateReasons(inventoryIdentityFromItem(group[0])),
      items: group
    });
  }

  return groups;
}

export function duplicateReasonSummary(
  kind: InventoryDuplicateMatchKind,
  reasons: readonly InventoryDuplicateReason[]
) {
  if (kind === "cert-number") {
    return reasons[0]?.message ?? "Certification number matches an existing inventory row.";
  }

  const labels = reasons.map((reason) => reason.label.toLocaleLowerCase());
  return `Exact duplicate: ${formatList(labels)} match.`;
}

function identityFields(identity: InventoryIdentity): IdentityField[] {
  const variants = normalizeVariants(identity.variantDetails);
  return [
    identityField("item-type", "Item type", identity.itemType, normalizeText, true),
    identityField("language", "Language", identity.language, normalizeText, true),
    identityField("name", "Card name", identity.name, normalizeText, true),
    identityField("set-code", "Set code", identity.setCode, normalizeText),
    identityField("card-number", "Card number", identity.cardNumber, normalizeCardNumber),
    identityField("condition", "Condition", identity.conditionLabel, normalizeText),
    {
      code: "variants",
      label: "Variants",
      normalized: variants,
      display: variants
    },
    identityField("grader", "Grader", identity.grader, normalizeText),
    identityField("grade", "Grade", identity.grade, normalizeText),
    identityField(
      "cert-number",
      "Certification number",
      identity.certNumber,
      normalizedInventoryCertNumber
    )
  ];
}

function identityField(
  code: InventoryDuplicateReasonCode,
  label: string,
  value: unknown,
  normalize: (value: unknown) => string,
  includeWhenEmpty = false
): IdentityField {
  return {
    code,
    label,
    normalized: normalize(value),
    display: String(value ?? "").trim(),
    includeWhenEmpty
  };
}

function toReason(field: IdentityField): InventoryDuplicateReason {
  const display = field.display || "not recorded";
  return {
    code: field.code,
    label: field.label,
    value: display,
    message: `${field.label} matches (${display}).`
  };
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function normalizeCardNumber(value: unknown) {
  return normalizeText(value).replace(/\b0+(\d)/g, "$1");
}

function normalizeVariants(value: unknown) {
  return normalizeText(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join(",");
}

function groupBy<T>(items: readonly T[], keyFor: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function formatList(values: string[]) {
  if (values.length === 0) return "identity fields";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
