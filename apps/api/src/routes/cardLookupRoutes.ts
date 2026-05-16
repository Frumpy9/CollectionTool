import { randomUUID } from "node:crypto";
import type {
  CardLookupRequest,
  JapaneseCardCacheResponse,
  UpsertJapaneseCardCacheRequest
} from "@collection-tool/shared";
import type { FastifyInstance } from "fastify";
import { getAuthContext, getCollectionRole, listCollectionsForUser } from "../auth.js";
import { lookupCards, parseCardQuery } from "../cardLookupClient.js";
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
      pokemonTcgApiKey: config.pokemonTcgApiKey,
      database
    });
  });

  app.post(
    "/api/cards/japanese-cache",
    async (request, reply): Promise<JapaneseCardCacheResponse | { error: string }> => {
      const auth = getAuthContext(request, database);

      if (!auth) {
        reply.code(401);
        return { error: "Unauthorized" };
      }

      const canEditAnyCollection = listCollectionsForUser(database, auth.user.id).some(
        (collection) =>
          getCollectionRole(database, collection.id, auth.user.id) &&
          collection.role !== "viewer"
      );

      if (!canEditAnyCollection) {
        reply.code(403);
        return { error: "You need editor access to cache Japanese cards." };
      }

      const input = normalizeJapaneseCacheInput(request.body as UpsertJapaneseCardCacheRequest);
      const id = upsertJapaneseCardCache(database, input);

      reply.code(201);
      return { ok: true, id };
    }
  );
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

function normalizeJapaneseCacheInput(input: UpsertJapaneseCardCacheRequest) {
  const setCode = input.setCode?.trim().toLowerCase();
  const cardNumber = input.cardNumber?.trim();
  const name = input.name?.trim();

  if (!setCode || !cardNumber || !name) {
    throw new Error("Set code, card number, and name are required.");
  }

  const parsed = parseCardQuery(`${setCode} ${cardNumber}`);

  return {
    source: input.source?.trim() || "manual",
    sourceId: input.sourceId?.trim() || `${setCode}:${cardNumber}`,
    setCode,
    setName: input.setName?.trim() || null,
    cardNumber,
    printedNumber: parsed.printedNumber ?? cardNumber.split("/")[0],
    printedTotal: parsed.setTotal,
    name,
    rarity: input.rarity?.trim() || null,
    imageUrl: input.imageUrl?.trim() || null,
    rawPayload: JSON.stringify(input)
  };
}

function upsertJapaneseCardCache(
  database: AppDatabase,
  input: ReturnType<typeof normalizeJapaneseCacheInput>
) {
  const existing = database.connection
    .prepare("SELECT id FROM japanese_card_cache WHERE source = ? AND source_id = ?")
    .get(input.source, input.sourceId) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();

  database.connection
    .prepare(
      `
        INSERT INTO japanese_card_cache (
          id,
          source,
          source_id,
          set_code,
          set_name,
          card_number,
          printed_number,
          printed_total,
          name,
          rarity,
          image_url,
          raw_payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, source_id) DO UPDATE SET
          set_code = excluded.set_code,
          set_name = excluded.set_name,
          card_number = excluded.card_number,
          printed_number = excluded.printed_number,
          printed_total = excluded.printed_total,
          name = excluded.name,
          rarity = excluded.rarity,
          image_url = excluded.image_url,
          raw_payload = excluded.raw_payload,
          updated_at = CURRENT_TIMESTAMP
      `
    )
    .run(
      id,
      input.source,
      input.sourceId,
      input.setCode,
      input.setName,
      input.cardNumber,
      input.printedNumber,
      input.printedTotal,
      input.name,
      input.rarity,
      input.imageUrl,
      input.rawPayload
    );

  return id;
}
