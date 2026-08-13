import { createHash, randomUUID } from "node:crypto";
import type {
  CreateInventoryItemRequest,
  CsvImportDuplicatePolicy,
  CsvImportJobIssue,
  CsvImportJobResponse,
  InventoryDuplicateMatchKind,
  InventoryDuplicateReason
} from "@collection-tool/shared";
import { recordCollectionValueSnapshot } from "./collectionValueSnapshots.js";
import type { AppDatabase } from "./db.js";
import { parseInventoryCsvImport, type ParsedCsvImportRow } from "./inventoryCsvImportParser.js";
import {
  certInventoryDuplicateReasons,
  duplicateReasonSummary,
  exactInventoryDuplicateReasons,
  inventoryDuplicateIdentityKey,
  inventoryIdentityFromPayload,
  normalizedInventoryCertNumber
} from "./inventoryDuplicateIdentity.js";

const JOB_TTL_MS = 60 * 60 * 1_000;
const VALIDATION_BATCH_SIZE = 50;
const MAX_VISIBLE_ISSUES = 100;
const MAX_ACTIVE_JOBS_PER_USER = 3;
const MAX_RETAINED_JOBS_PER_USER = 20;

type PlannedAction =
  | { type: "insert" }
  | { type: "merge"; target: string; resultingQuantity: number }
  | { type: "invalid"; messages: string[] }
  | {
      type: "skip";
      messages: string[];
      duplicateMatch?: {
        kind: InventoryDuplicateMatchKind;
        reasons: InventoryDuplicateReason[];
      };
    };

type PlannedRow = ParsedCsvImportRow & { action: PlannedAction };

type CsvImportJob = CsvImportJobResponse & {
  ownerUserId: string;
  csvText: string;
  rows: PlannedRow[];
  inventoryFingerprint: string | null;
};

type InventoryIdentity = {
  target: string;
  key: string;
  certNumber: string;
  quantity: number;
};

export class CsvImportJobError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export class CsvImportJobManager {
  private readonly jobs = new Map<string, CsvImportJob>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private readonly database: AppDatabase) {
    this.cleanupTimer = setInterval(() => this.cleanupExpiredJobs(), 15 * 60 * 1_000);
    this.cleanupTimer.unref();
  }

  create(
    collectionId: string,
    ownerUserId: string,
    csvText: string,
    duplicatePolicy: CsvImportDuplicatePolicy
  ) {
    this.cleanupExpiredJobs();
    this.pruneRetainedJobs(ownerUserId);
    const activeJobCount = [...this.jobs.values()].filter(
      (job) => job.ownerUserId === ownerUserId && !isTerminal(job.status)
    ).length;

    if (activeJobCount >= MAX_ACTIVE_JOBS_PER_USER) {
      throw new CsvImportJobError("Finish or cancel an active CSV import before starting another.", 429);
    }

    const timestamp = new Date().toISOString();
    const job: CsvImportJob = {
      id: randomUUID(),
      collectionId,
      ownerUserId,
      csvText,
      rows: [],
      inventoryFingerprint: null,
      status: "queued",
      duplicatePolicy,
      progress: { processedRows: 0, totalRows: 0 },
      summary: emptySummary(),
      issues: [],
      issuesTruncated: false,
      planHash: null,
      requiresExclusionAcknowledgement: false,
      cancellationRequested: false,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    };

    this.jobs.set(job.id, job);
    setImmediate(() => void this.validate(job));
    return publicJob(job);
  }

  get(jobId: string, collectionId: string, ownerUserId: string) {
    return publicJob(this.requireOwnedJob(jobId, collectionId, ownerUserId));
  }

  list(collectionId: string, ownerUserId: string) {
    this.cleanupExpiredJobs();
    return [...this.jobs.values()]
      .filter(
        (job) => job.collectionId === collectionId && job.ownerUserId === ownerUserId
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(publicJob);
  }

  cancel(jobId: string, collectionId: string, ownerUserId: string) {
    const job = this.requireOwnedJob(jobId, collectionId, ownerUserId);

    if (job.status === "committing") {
      throw new CsvImportJobError("This import is already committing and can no longer be cancelled.", 409);
    }

    if (!isTerminal(job.status)) {
      job.cancellationRequested = true;
      setStatus(job, "cancelled");
      job.completedAt = job.updatedAt;
    }

    return publicJob(job);
  }

  commit(
    jobId: string,
    collectionId: string,
    ownerUserId: string,
    planHash: string,
    acknowledgeExclusions: boolean
  ) {
    const job = this.requireOwnedJob(jobId, collectionId, ownerUserId);

    if (job.status !== "ready") {
      throw new CsvImportJobError("This CSV import is not ready to commit.", 409);
    }
    if (!planHash || planHash !== job.planHash) {
      throw new CsvImportJobError("The CSV import plan changed. Preview the file again.", 409);
    }
    if (job.summary.commitRows === 0) {
      throw new CsvImportJobError("This CSV has no valid rows to commit.", 400);
    }
    if (job.requiresExclusionAcknowledgement && !acknowledgeExclusions) {
      throw new CsvImportJobError(
        `Acknowledge that ${job.summary.excludedRows} excluded row(s) will not be imported.`,
        400
      );
    }
    if (inventoryFingerprint(this.database, collectionId) !== job.inventoryFingerprint) {
      throw new CsvImportJobError(
        "Inventory changed after this preview. Preview the CSV again before importing.",
        409
      );
    }

    setStatus(job, "committing");
    const insertedTargets = new Map<string, string>();
    let transactionStarted = false;

    try {
      this.database.connection.exec("BEGIN IMMEDIATE");
      transactionStarted = true;

      for (const row of job.rows) {
        if (row.action.type === "insert") {
          const itemId = insertInventoryRow(this.database, collectionId, row.payload);
          insertedTargets.set(`row:${row.index}`, itemId);
        } else if (row.action.type === "merge") {
          const targetItemId = row.action.target.startsWith("row:")
            ? insertedTargets.get(row.action.target)
            : row.action.target.slice(3);

          if (!targetItemId) {
            throw new Error("CSV merge target is unavailable.");
          }

          mergeInventoryRow(
            this.database,
            collectionId,
            targetItemId,
            row.action.resultingQuantity,
            row.payload.imageUrl
          );
        }
      }

      recordCollectionValueSnapshot(
        this.database,
        collectionId,
        "inventory_add",
        job.summary.commitRows
      );
      this.database.connection.exec("COMMIT");
      setStatus(job, "completed");
      job.completedAt = job.updatedAt;
      job.csvText = "";
      return publicJob(job);
    } catch (error) {
      if (transactionStarted) {
        try {
          this.database.connection.exec("ROLLBACK");
        } catch {
          // Preserve the stable public failure below even if SQLite cannot roll back.
        }
      }
      job.error = "The CSV import could not be committed. No inventory changes were saved.";
      setStatus(job, "failed");
      job.completedAt = job.updatedAt;
      throw new CsvImportJobError(job.error, 500);
    }
  }

  errorReport(jobId: string, collectionId: string, ownerUserId: string) {
    const job = this.requireOwnedJob(jobId, collectionId, ownerUserId);
    const rows = job.rows.filter(
      (row): row is PlannedRow & {
        action: Extract<PlannedAction, { type: "invalid" | "skip" }>;
      } => row.action.type === "invalid" || row.action.type === "skip"
    );
    const diagnosticRows = job.error
      ? [["0", "job", "CSV import", boundedText(job.error, 500)]]
      : [];
    const csvRows = [
      ["line_number", "disposition", "name", "messages"],
      ...diagnosticRows,
      ...rows.map((row) => [
        String(row.lineNumber),
        row.action.type === "invalid" ? "invalid" : "skipped",
        row.name,
        row.action.messages.join(" ")
      ])
    ];
    return csvRows.map((row) => row.map(safeCsvCell).join(",")).join("\n");
  }

  dispose() {
    clearInterval(this.cleanupTimer);
    this.jobs.clear();
  }

  private async validate(job: CsvImportJob) {
    if (job.status === "cancelled") return;
    setStatus(job, "validating");

    try {
      const parsedRows = parseInventoryCsvImport(job.csvText);
      job.progress.totalRows = parsedRows.length;
      job.summary.totalRows = parsedRows.length;
      const state = loadInventoryIdentity(this.database, job.collectionId);
      job.inventoryFingerprint = state.fingerprint;
      const identitiesByKey = new Map(state.identities.map((identity) => [identity.key, identity]));
      const certNumbers = new Set(
        state.identities.map((identity) => identity.certNumber).filter(Boolean)
      );

      for (let start = 0; start < parsedRows.length; start += VALIDATION_BATCH_SIZE) {
        if (job.cancellationRequested) return;
        const batch = parsedRows.slice(start, start + VALIDATION_BATCH_SIZE);

        for (const row of batch) {
          const planned = planRow(row, job.duplicatePolicy, identitiesByKey, certNumbers);
          job.rows.push(planned);
          applyPlanToState(planned, identitiesByKey, certNumbers);
          job.progress.processedRows += 1;
          incrementSummary(job, planned.action);
        }

        job.updatedAt = new Date().toISOString();
        await yieldToEventLoop();
      }

      if (job.cancellationRequested) return;
      job.requiresExclusionAcknowledgement = job.summary.excludedRows > 0;
      const allIssues = issuesForRows(job.rows);
      job.issues = allIssues.slice(0, MAX_VISIBLE_ISSUES);
      job.issuesTruncated = allIssues.length > job.issues.length;
      job.planHash = planHash(job);
      job.csvText = "";
      setStatus(job, "ready");
    } catch (error) {
      job.error = boundedText(
        error instanceof Error ? error.message : "Unable to validate this CSV file.",
        500
      );
      setStatus(job, "failed");
      job.completedAt = job.updatedAt;
      job.csvText = "";
    }
  }

  private requireOwnedJob(jobId: string, collectionId: string, ownerUserId: string) {
    const job = this.jobs.get(jobId);
    if (!job || job.collectionId !== collectionId || job.ownerUserId !== ownerUserId) {
      throw new CsvImportJobError("CSV import job not found.", 404);
    }
    return job;
  }

  private cleanupExpiredJobs() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [jobId, job] of this.jobs) {
      if (Date.parse(job.updatedAt) < cutoff) this.jobs.delete(jobId);
    }
  }

  private pruneRetainedJobs(ownerUserId: string) {
    const retained = [...this.jobs.values()]
      .filter((job) => job.ownerUserId === ownerUserId && isTerminal(job.status))
      .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));

    while (retained.length >= MAX_RETAINED_JOBS_PER_USER) {
      const oldest = retained.shift();
      if (oldest) this.jobs.delete(oldest.id);
    }
  }
}

function planRow(
  row: ParsedCsvImportRow,
  duplicatePolicy: CsvImportDuplicatePolicy,
  identitiesByKey: Map<string, InventoryIdentity>,
  certNumbers: Set<string>
): PlannedRow {
  if (row.errors.length > 0) {
    return { ...row, action: { type: "invalid", messages: row.errors } };
  }

  const certNumber = normalizedInventoryCertNumber(row.payload.certNumber);
  if (certNumber && certNumbers.has(certNumber)) {
    const reasons = certInventoryDuplicateReasons(inventoryIdentityFromPayload(row.payload));
    return {
      ...row,
      action: {
        type: "skip",
        messages: [duplicateReasonSummary("cert-number", reasons)],
        duplicateMatch: { kind: "cert-number", reasons }
      }
    };
  }

  const key = duplicateKey(row.payload);
  const duplicate = identitiesByKey.get(key);
  if (!duplicate || duplicatePolicy === "separate") {
    return { ...row, action: { type: "insert" } };
  }
  if (duplicatePolicy === "skip") {
    const reasons = exactInventoryDuplicateReasons(inventoryIdentityFromPayload(row.payload));
    return {
      ...row,
      action: {
        type: "skip",
        messages: [duplicateReasonSummary("exact-identity", reasons)],
        duplicateMatch: { kind: "exact-identity", reasons }
      }
    };
  }

  const resultingQuantity = duplicate.quantity + row.payload.quantity;
  if (resultingQuantity > 999) {
    return {
      ...row,
      action: {
        type: "invalid",
        messages: ["Merging this duplicate would exceed the maximum quantity of 999."]
      }
    };
  }
  return {
    ...row,
    action: { type: "merge", target: duplicate.target, resultingQuantity }
  };
}

function applyPlanToState(
  row: PlannedRow,
  identitiesByKey: Map<string, InventoryIdentity>,
  certNumbers: Set<string>
) {
  if (row.action.type === "insert") {
    const identity = {
      target: `row:${row.index}`,
      key: duplicateKey(row.payload),
      certNumber: normalizedInventoryCertNumber(row.payload.certNumber),
      quantity: row.payload.quantity
    };
    identitiesByKey.set(identity.key, identity);
    if (identity.certNumber) certNumbers.add(identity.certNumber);
  } else if (row.action.type === "merge") {
    const identity = identitiesByKey.get(duplicateKey(row.payload));
    if (identity) identity.quantity = row.action.resultingQuantity;
    const certNumber = normalizedInventoryCertNumber(row.payload.certNumber);
    if (certNumber) certNumbers.add(certNumber);
  }
}

function loadInventoryIdentity(database: AppDatabase, collectionId: string) {
  const rows = database.connection
    .prepare(
      `
        SELECT
          oi.id, oi.item_type, oi.quantity, oi.condition_label, oi.variant_details,
          oi.grader, oi.grade, oi.cert_number, oi.purchase_price_cents, oi.purchase_date,
          oi.value_override_cents, oi.storage_location, oi.notes, oi.cert_url,
          oi.cert_spec_id, oi.cert_category, oi.cert_population, oi.cert_population_higher,
          oi.cert_estimate_cents, oi.cert_lookup_at, oi.created_at, oi.updated_at,
          c.name, c.set_name, c.set_code, c.card_number, c.language, c.rarity,
          c.release_year, c.image_url, c.updated_at AS card_updated_at
        FROM owned_items oi
        JOIN cards c ON c.id = oi.card_id
        WHERE oi.collection_id = ?
        ORDER BY oi.id
      `
    )
    .all(collectionId) as Array<Record<string, string | number | null>>;
  const identities = rows.map((row) => ({
    target: `db:${row.id}`,
    key: duplicateKey({
      itemType: row.item_type,
      language: row.language,
      name: row.name,
      setCode: row.set_code,
      cardNumber: row.card_number,
      conditionLabel: row.condition_label,
      variantDetails: row.variant_details,
      grader: row.grader,
      grade: row.grade,
      certNumber: row.cert_number
    }),
    certNumber: normalizedInventoryCertNumber(row.cert_number),
    quantity: Number(row.quantity)
  }));
  return { identities, fingerprint: sha256(JSON.stringify(rows)) };
}

function inventoryFingerprint(database: AppDatabase, collectionId: string) {
  return loadInventoryIdentity(database, collectionId).fingerprint;
}

function duplicateKey(payload: Record<string, unknown>) {
  return inventoryDuplicateIdentityKey(inventoryIdentityFromPayload(payload));
}

function insertInventoryRow(
  database: AppDatabase,
  collectionId: string,
  input: CreateInventoryItemRequest
) {
  const cardId = randomUUID();
  const itemId = randomUUID();
  database.connection
    .prepare(
      `INSERT INTO cards (
        id, name, set_name, set_code, card_number, language, rarity, release_year, image_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cardId,
      input.name.trim(),
      nullIfBlank(input.setName),
      nullIfBlank(input.setCode),
      nullIfBlank(input.cardNumber),
      input.language,
      nullIfBlank(input.rarity),
      nullIfBlank(input.releaseYear),
      nullIfBlank(input.imageUrl)
    );
  database.connection
    .prepare(
      `INSERT INTO owned_items (
        id, collection_id, card_id, item_type, quantity, condition_label, condition_score,
        variant_details, grader, grade, cert_number, purchase_price_cents, purchase_date,
        value_override_cents, storage_location, notes, cert_url, cert_spec_id, cert_category,
        cert_population, cert_population_higher, cert_estimate_cents, cert_lookup_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      itemId,
      collectionId,
      cardId,
      input.itemType,
      input.quantity,
      nullIfBlank(input.conditionLabel),
      input.conditionScore ?? null,
      nullIfBlank(input.variantDetails),
      nullIfBlank(input.grader),
      nullIfBlank(input.grade),
      nullIfBlank(input.certNumber),
      input.purchasePriceCents ?? null,
      nullIfBlank(input.purchaseDate),
      input.valueOverrideCents ?? null,
      nullIfBlank(input.storageLocation),
      nullIfBlank(input.notes),
      nullIfBlank(input.certUrl),
      nullIfBlank(input.certSpecId),
      nullIfBlank(input.certCategory),
      nullIfBlank(input.certPopulation),
      nullIfBlank(input.certPopulationHigher),
      input.certEstimateCents ?? null,
      nullIfBlank(input.certLookupAt)
    );
  return itemId;
}

function mergeInventoryRow(
  database: AppDatabase,
  collectionId: string,
  itemId: string,
  quantity: number,
  imageUrl: string | undefined
) {
  const result = database.connection
    .prepare(
      `UPDATE owned_items
       SET quantity = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND collection_id = ?`
    )
    .run(quantity, itemId, collectionId);
  if (result.changes !== 1) throw new Error("CSV merge target is unavailable.");
  if (nullIfBlank(imageUrl)) {
    database.connection
      .prepare(
        `UPDATE cards SET image_url = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = (SELECT card_id FROM owned_items WHERE id = ?)
           AND (image_url IS NULL OR trim(image_url) = '')`
      )
      .run(imageUrl!.trim(), itemId);
  }
}

function incrementSummary(job: CsvImportJob, action: PlannedAction) {
  if (action.type === "insert") {
    job.summary.insertRows += 1;
    job.summary.commitRows += 1;
  } else if (action.type === "merge") {
    job.summary.mergeRows += 1;
    job.summary.commitRows += 1;
  } else if (action.type === "invalid") {
    job.summary.invalidRows += 1;
    job.summary.excludedRows += 1;
  } else {
    job.summary.skippedRows += 1;
    job.summary.excludedRows += 1;
  }
}

function issuesForRows(rows: PlannedRow[]): CsvImportJobIssue[] {
  return rows.flatMap((row) => {
    if (row.action.type !== "invalid" && row.action.type !== "skip") return [];
    return [{
      lineNumber: row.lineNumber,
      name: boundedText(row.name, 200),
      disposition: row.action.type === "invalid" ? "invalid" as const : "skipped" as const,
      messages: row.action.messages.map((message) => boundedText(message, 500)),
      ...(row.action.type === "skip" && row.action.duplicateMatch
        ? { duplicateMatch: row.action.duplicateMatch }
        : {})
    }];
  });
}

function planHash(job: CsvImportJob) {
  return sha256(JSON.stringify({
    collectionId: job.collectionId,
    duplicatePolicy: job.duplicatePolicy,
    inventoryFingerprint: job.inventoryFingerprint,
    rows: job.rows.map((row) => ({
      lineNumber: row.lineNumber,
      payload: row.payload,
      action: row.action
    }))
  }));
}

function publicJob(job: CsvImportJob): CsvImportJobResponse {
  const {
    ownerUserId: _ownerUserId,
    csvText: _csvText,
    rows: _rows,
    inventoryFingerprint: _inventoryFingerprint,
    ...response
  } = job;
  return structuredClone(response);
}

function emptySummary() {
  return {
    totalRows: 0,
    commitRows: 0,
    insertRows: 0,
    mergeRows: 0,
    invalidRows: 0,
    skippedRows: 0,
    excludedRows: 0
  };
}

function setStatus(job: CsvImportJob, status: CsvImportJobResponse["status"]) {
  job.status = status;
  job.updatedAt = new Date().toISOString();
}

function isTerminal(status: CsvImportJobResponse["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function safeCsvCell(value: string) {
  let text = boundedText(value, 2_000);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function boundedText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function nullIfBlank(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}


function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}
