import type { FastifyInstance } from "fastify";
import type { PsaCertLookupRequest } from "@collection-tool/shared";
import { getAuthContext } from "../auth.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import { lookupPsaCert } from "../psaClient.js";

export async function registerPsaRoutes(
  app: FastifyInstance,
  config: AppConfig,
  database: AppDatabase
) {
  app.post("/api/psa/cert/lookup", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const body = request.body as PsaCertLookupRequest;
    const certNumber = normalizeCertNumber(body.certNumber);

    if (!certNumber) {
      reply.code(400);
      throw new Error("Enter a numeric PSA cert number.");
    }

    return lookupPsaCert({
      accessToken: config.psaAccessToken,
      pokemonTcgApiKey: config.pokemonTcgApiKey,
      certNumber
    });
  });
}

function normalizeCertNumber(certNumber: string | undefined) {
  const normalized = certNumber?.replace(/\D/g, "") ?? "";
  return normalized.length >= 4 && normalized.length <= 12 ? normalized : null;
}
