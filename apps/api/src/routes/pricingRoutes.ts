import type {
  JustTcgPricingCandidate,
  SelectJustTcgPricingRequest
} from "@collection-tool/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { getAuthContext, getCollectionRole } from "../auth.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import {
  findJustTcgPricingCandidateByIds,
  lookupJustTcgPricing,
  type JustTcgPricingCandidateWithPayload
} from "../justTcgClient.js";
import { listInventoryItems } from "./inventoryRoutes.js";

export async function registerPricingRoutes(
  app: FastifyInstance,
  config: AppConfig,
  database: AppDatabase
) {
  app.post(
    "/api/collections/:collectionId/items/:itemId/pricing/justtcg/refresh",
    async (request, reply) => {
      const access = getPricingAccess(request, database);

      if (!access.ok) {
        reply.code(access.statusCode);
        return { error: access.message };
      }

      const item = getInventoryItem(database, access.collectionId, access.itemId);

      if (!item) {
        reply.code(404);
        return { error: "Inventory item not found." };
      }

      if (item.itemType !== "raw") {
        reply.code(400);
        return { error: "JustTCG pricing is only available for raw cards." };
      }

      const result = await lookupJustTcgPricing({
        apiKey: config.justTcgApiKey,
        item
      }).catch((error) => {
        reply.code(statusCodeForPricingError(error));
        return {
          error: error instanceof Error ? error.message : "Unable to refresh JustTCG pricing."
        };
      });

      if ("error" in result) {
        return result;
      }

      if (result.status === "match") {
        saveMarketPrice(database, access.itemId, result.candidate);
        const updatedItem = getInventoryItem(database, access.collectionId, access.itemId);

        return {
          status: "saved",
          item: updatedItem,
          candidates: toPublicCandidates(result.candidates),
          message: "Saved JustTCG market price."
        };
      }

      return {
        status: "needs-review",
        item: null,
        candidates: toPublicCandidates(result.candidates),
        message: result.message
      };
    }
  );

  app.post(
    "/api/collections/:collectionId/items/:itemId/pricing/justtcg/select",
    async (request, reply) => {
      const access = getPricingAccess(request, database);

      if (!access.ok) {
        reply.code(access.statusCode);
        return { error: access.message };
      }

      const item = getInventoryItem(database, access.collectionId, access.itemId);

      if (!item) {
        reply.code(404);
        return { error: "Inventory item not found." };
      }

      if (item.itemType !== "raw") {
        reply.code(400);
        return { error: "JustTCG pricing is only available for raw cards." };
      }

      const input = request.body as SelectJustTcgPricingRequest;
      const sourceCardId = input.sourceCardId?.trim();
      const sourceVariantId = input.sourceVariantId?.trim();

      if (!sourceCardId || !sourceVariantId) {
        reply.code(400);
        return { error: "Choose a JustTCG card and variant before saving." };
      }

      const selectedCandidate = candidateFromSelection(input, sourceCardId, sourceVariantId);
      const candidate =
        selectedCandidate ??
        (await findJustTcgPricingCandidateByIds({
          apiKey: config.justTcgApiKey,
          item,
          sourceCardId,
          sourceVariantId
        }).catch((error) => {
          reply.code(statusCodeForPricingError(error));
          return {
            error: error instanceof Error ? error.message : "Unable to save JustTCG pricing."
          };
        }));

      if (candidate && "error" in candidate) {
        return candidate;
      }

      if (!candidate) {
        reply.code(404);
        return { error: "That JustTCG price candidate is no longer available." };
      }

      saveMarketPrice(database, access.itemId, candidate);
      const updatedItem = getInventoryItem(database, access.collectionId, access.itemId);

      return {
        status: "saved",
        item: updatedItem,
        candidates: [toPublicCandidate(candidate)],
        message: "Saved selected JustTCG market price."
      };
    }
  );
}

function getPricingAccess(request: FastifyRequest, database: AppDatabase) {
  const auth = getAuthContext(request, database);

  if (!auth) {
    return {
      ok: false as const,
      statusCode: 401,
      message: "Unauthorized"
    };
  }

  const { collectionId, itemId } = request.params as { collectionId: string; itemId: string };
  const role = getCollectionRole(database, collectionId, auth.user.id);

  if (!role || role === "viewer") {
    return {
      ok: false as const,
      statusCode: 403,
      message: "You need editor access to refresh prices."
    };
  }

  return {
    ok: true as const,
    collectionId,
    itemId
  };
}

function getInventoryItem(database: AppDatabase, collectionId: string, itemId: string) {
  return listInventoryItems(database, collectionId).find((item) => item.id === itemId) ?? null;
}

function saveMarketPrice(
  database: AppDatabase,
  itemId: string,
  candidate: JustTcgPricingCandidateWithPayload
) {
  const lookedUpAt = new Date().toISOString();

  database.connection
    .prepare(
      `
        INSERT INTO item_market_prices (
          owned_item_id,
          source,
          source_card_id,
          source_variant_id,
          matched_name,
          matched_set_name,
          matched_card_number,
          condition_label,
          printing,
          language,
          price_cents,
          currency,
          confidence,
          looked_up_at,
          raw_payload,
          updated_at
        )
        VALUES (?, 'justtcg', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(owned_item_id) DO UPDATE SET
          source = excluded.source,
          source_card_id = excluded.source_card_id,
          source_variant_id = excluded.source_variant_id,
          matched_name = excluded.matched_name,
          matched_set_name = excluded.matched_set_name,
          matched_card_number = excluded.matched_card_number,
          condition_label = excluded.condition_label,
          printing = excluded.printing,
          language = excluded.language,
          price_cents = excluded.price_cents,
          currency = excluded.currency,
          confidence = excluded.confidence,
          looked_up_at = excluded.looked_up_at,
          raw_payload = excluded.raw_payload,
          updated_at = CURRENT_TIMESTAMP
      `
    )
    .run(
      itemId,
      candidate.sourceCardId,
      candidate.sourceVariantId,
      candidate.matchedName,
      candidate.matchedSetName,
      candidate.matchedCardNumber,
      candidate.condition,
      candidate.printing,
      candidate.language,
      candidate.priceCents,
      candidate.confidence,
      lookedUpAt,
      JSON.stringify(candidate.rawPayload)
    );
}

function toPublicCandidates(candidates: JustTcgPricingCandidateWithPayload[]) {
  return candidates.map(toPublicCandidate);
}

function toPublicCandidate(candidate: JustTcgPricingCandidateWithPayload): JustTcgPricingCandidate {
  return {
    sourceCardId: candidate.sourceCardId,
    sourceVariantId: candidate.sourceVariantId,
    matchedName: candidate.matchedName,
    matchedSetName: candidate.matchedSetName,
    matchedCardNumber: candidate.matchedCardNumber,
    condition: candidate.condition,
    printing: candidate.printing,
    language: candidate.language,
    priceCents: candidate.priceCents,
    currency: candidate.currency,
    confidence: candidate.confidence,
    score: candidate.score
  };
}

function candidateFromSelection(
  input: SelectJustTcgPricingRequest,
  sourceCardId: string,
  sourceVariantId: string
): JustTcgPricingCandidateWithPayload | null {
  if (
    !input.candidate ||
    input.candidate.sourceCardId !== sourceCardId ||
    input.candidate.sourceVariantId !== sourceVariantId
  ) {
    return null;
  }

  return {
    ...input.candidate,
    rawPayload: {
      selectedCandidate: input.candidate
    }
  };
}

function statusCodeForPricingError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("rate limit")) {
    return 429;
  }

  if (message.includes("JUSTTCG_API_KEY")) {
    return 400;
  }

  return 502;
}
