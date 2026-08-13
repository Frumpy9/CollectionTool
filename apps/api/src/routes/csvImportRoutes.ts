import type {
  CommitCsvImportJobRequest,
  CreateCsvImportJobRequest,
  CsvImportDuplicatePolicy
} from "@collection-tool/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAuthContext, getCollectionRole } from "../auth.js";
import type { AppDatabase } from "../db.js";
import {
  CsvImportJobError,
  CsvImportJobManager
} from "../inventoryCsvImportJobs.js";
import { MAX_CSV_IMPORT_BYTES } from "../inventoryCsvImportParser.js";

const CSV_IMPORT_BODY_LIMIT = MAX_CSV_IMPORT_BYTES + 64 * 1024;

export async function registerCsvImportRoutes(app: FastifyInstance, database: AppDatabase) {
  const jobs = new CsvImportJobManager(database);
  app.addHook("onClose", async () => jobs.dispose());

  app.post(
    "/api/collections/:collectionId/csv-imports",
    { bodyLimit: CSV_IMPORT_BODY_LIMIT },
    async (request, reply) => {
      const access = requireEditor(request, reply, database);
      if (!access) return;
      const input = request.body as CreateCsvImportJobRequest;
      const duplicatePolicy = normalizeDuplicatePolicy(input?.duplicatePolicy);

      if (!duplicatePolicy) {
        reply.code(400);
        return { error: "Choose skip, merge, or separate for exact duplicates." };
      }
      if (typeof input?.csvText !== "string" || input.csvText.trim().length === 0) {
        reply.code(400);
        return { error: "Paste or upload a CSV file before previewing." };
      }

      try {
        reply.code(202);
        return jobs.create(access.collectionId, access.userId, input.csvText, duplicatePolicy);
      } catch (error) {
        return sendJobError(reply, error);
      }
    }
  );

  app.get("/api/collections/:collectionId/csv-imports", async (request, reply) => {
    const access = requireEditor(request, reply, database);
    if (!access) return;
    return { jobs: jobs.list(access.collectionId, access.userId) };
  });

  app.get("/api/collections/:collectionId/csv-imports/:jobId", async (request, reply) => {
    const access = requireEditor(request, reply, database);
    if (!access) return;
    const { jobId } = request.params as { jobId: string };
    try {
      return jobs.get(jobId, access.collectionId, access.userId);
    } catch (error) {
      return sendJobError(reply, error);
    }
  });

  app.post(
    "/api/collections/:collectionId/csv-imports/:jobId/commit",
    async (request, reply) => {
      const access = requireEditor(request, reply, database);
      if (!access) return;
      const { jobId } = request.params as { jobId: string };
      const input = request.body as CommitCsvImportJobRequest;
      try {
        return jobs.commit(
          jobId,
          access.collectionId,
          access.userId,
          typeof input?.planHash === "string" ? input.planHash : "",
          input?.acknowledgeExclusions === true
        );
      } catch (error) {
        return sendJobError(reply, error);
      }
    }
  );

  app.post(
    "/api/collections/:collectionId/csv-imports/:jobId/cancel",
    async (request, reply) => {
      const access = requireEditor(request, reply, database);
      if (!access) return;
      const { jobId } = request.params as { jobId: string };
      try {
        return jobs.cancel(jobId, access.collectionId, access.userId);
      } catch (error) {
        return sendJobError(reply, error);
      }
    }
  );

  app.get(
    "/api/collections/:collectionId/csv-imports/:jobId/errors.csv",
    async (request, reply) => {
      const access = requireEditor(request, reply, database);
      if (!access) return;
      const { jobId } = request.params as { jobId: string };
      try {
        const report = jobs.errorReport(jobId, access.collectionId, access.userId);
        reply
          .type("text/csv; charset=utf-8")
          .header("Content-Disposition", `attachment; filename="csv-import-${jobId}-errors.csv"`);
        return report;
      } catch (error) {
        return sendJobError(reply, error);
      }
    }
  );
}

function requireEditor(request: FastifyRequest, reply: FastifyReply, database: AppDatabase) {
  const auth = getAuthContext(request, database);
  if (!auth) {
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
  const { collectionId } = request.params as { collectionId: string };
  const role = getCollectionRole(database, collectionId, auth.user.id);
  if (!role || role === "viewer") {
    reply.code(403).send({ error: "You need editor access to import cards." });
    return null;
  }
  return { collectionId, userId: auth.user.id };
}

function normalizeDuplicatePolicy(value: unknown): CsvImportDuplicatePolicy | null {
  return value === "skip" || value === "merge" || value === "separate" ? value : null;
}

function sendJobError(reply: FastifyReply, error: unknown) {
  if (error instanceof CsvImportJobError) {
    reply.code(error.statusCode);
    return { error: error.message };
  }
  reply.code(500);
  return { error: "The CSV import request could not be completed." };
}
