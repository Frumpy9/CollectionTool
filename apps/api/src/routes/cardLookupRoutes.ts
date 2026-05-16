import type { CardLookupRequest } from "@collection-tool/shared";
import type { FastifyInstance } from "fastify";
import { getAuthContext } from "../auth.js";
import { lookupCards } from "../cardLookupClient.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";

export async function registerCardLookupRoutes(
  app: FastifyInstance,
  config: AppConfig,
  database: AppDatabase
) {
  app.post("/api/cards/lookup", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const body = normalizeCardLookupRequest(request.body as CardLookupRequest);

    return lookupCards({
      query: body.query,
      language: body.language,
      pokemonTcgApiKey: config.pokemonTcgApiKey
    });
  });
}

function normalizeCardLookupRequest(input: CardLookupRequest): Required<CardLookupRequest> {
  const query = input.query?.trim();
  const language = input.language ?? "all";

  if (!query || query.length < 2) {
    throw new Error("Enter at least 2 characters to look up a card.");
  }

  if (query.length > 80) {
    throw new Error("Lookup text is too long.");
  }

  if (!["all", "en", "ja", "other"].includes(language)) {
    throw new Error("Lookup language must be all, en, ja, or other.");
  }

  return {
    query,
    language: language === "other" ? "all" : language
  };
}
