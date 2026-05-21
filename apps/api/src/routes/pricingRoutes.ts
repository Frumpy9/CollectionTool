import { randomUUID } from "node:crypto";
import type {
  BulkPriceQueueJob,
  BulkPriceQueueMode,
  BulkPriceQueueResponse,
  BulkPriceQueueStatus,
  CardImageLookupResponse,
  EnqueueBulkPriceRefreshRequest,
  InventoryMarketPriceSource,
  InventoryItem,
  MarketPriceSnapshot,
  MarketPriceSnapshotsResponse,
  PokemonPriceTrackerPricingCandidate,
  PricingCandidate,
  PricingHistoryPoint,
  PricingHistoryResponse,
  SelectPokemonPriceTrackerPricingRequest,
  SelectPricingRequest
} from "@collection-tool/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { getAuthContext, getCollectionRole } from "../auth.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import {
  findPokemonPriceTrackerPricingCandidateByIds,
  lookupPokemonPriceTrackerImageCandidates,
  lookupPokemonPriceTrackerHistory,
  lookupPokemonPriceTrackerPricing,
  type PokemonPriceTrackerPricingCandidateWithPayload
} from "../pokemonPriceTrackerClient.js";
import { listInventoryItems } from "./inventoryRoutes.js";

const activeBulkPriceQueueCollections = new Set<string>();
const bulkPriceQueueIntervalMs = 60 * 1000;

export async function registerPricingRoutes(
  app: FastifyInstance,
  config: AppConfig,
  database: AppDatabase
) {
  app.post(
    "/api/collections/:collectionId/items/:itemId/pricing/refresh",
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

      clearItemPriceRefreshIgnored(database, item.id);

      const result = await refreshPricingForItem({
        config,
        database,
        collectionId: access.collectionId,
        item,
        includeQueueOnRateLimit: true
      }).catch((error) => {
        if (statusCodeForPricingError(error) === 429) {
          enqueueBulkPriceJob({
            database,
            collectionId: access.collectionId,
            itemId: item.id,
            mode: item.itemType,
            includeExisting: true,
            message: error instanceof Error ? error.message : "Rate limit reached."
          });

          return {
            status: "queued" as const,
            item: null,
            candidates: [],
            message: "Pricing API rate limit reached. This card was added to the price queue.",
            queue: getBulkQueueResponse(
              database,
              access.collectionId,
              "Queued this card for later price refresh."
            )
          };
        }

        reply.code(statusCodeForPricingError(error));
        return {
          error: error instanceof Error ? error.message : "Unable to refresh market pricing."
        };
      });

      if ("error" in result) {
        return result;
      }

      return result;
    }
  );

  app.post(
    "/api/collections/:collectionId/items/:itemId/pricing/select",
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

      const input = request.body as SelectPricingRequest;
      const sourceCardId = input.sourceCardId?.trim();
      const sourceVariantId = input.sourceVariantId?.trim();
      const source = input.source ?? input.candidate?.source ?? "pokemonpricetracker";

      if (!sourceCardId || !sourceVariantId) {
        reply.code(400);
        return { error: "Choose a price candidate before saving." };
      }

      if (source !== "pokemonpricetracker") {
        reply.code(400);
        return { error: "JustTCG pricing is disabled. Use PokemonPriceTracker pricing." };
      }

      const candidate = await selectedPricingCandidate({
        config,
        input,
        item,
        source,
        sourceCardId,
        sourceVariantId
      }).catch((error) => {
        reply.code(statusCodeForPricingError(error));
        return {
          error: error instanceof Error ? error.message : "Unable to save market pricing."
        };
      });

      if (candidate && "error" in candidate) {
        return candidate;
      }

      if (!candidate) {
        reply.code(404);
        return { error: "That price candidate is no longer available." };
      }

      saveMarketPrice(database, access.itemId, source, candidate, "manual");
      const updatedItem = getInventoryItem(database, access.collectionId, access.itemId);

      return {
        status: "saved",
        item: updatedItem,
        candidates: [toPublicPricingCandidate(candidate, source)],
        message: "Saved selected market price."
      };
    }
  );

  app.get(
    "/api/collections/:collectionId/items/:itemId/pricing/image-candidates",
    async (request, reply): Promise<CardImageLookupResponse | { error: string }> => {
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

      const sourceMatch = getPricingSourceMatch(database, item.id, "pokemonpricetracker");
      const candidates = await lookupPokemonPriceTrackerImageCandidates({
        apiKey: config.pokemonPriceTrackerApiKey,
        item,
        preferredSourceCardId: sourceMatch?.source_card_id ?? null
      }).catch((error) => {
        reply.code(statusCodeForPricingError(error));
        return {
          error:
            error instanceof Error
              ? error.message
              : "Unable to load PokemonPriceTracker image candidates."
        };
      });

      if ("error" in candidates) {
        return candidates;
      }

      return {
        candidates,
        message:
          candidates.length > 0
            ? "Loaded PokemonPriceTracker image candidates."
            : "No PokemonPriceTracker image candidates found."
      };
    }
  );

  app.get(
    "/api/collections/:collectionId/items/:itemId/pricing/history",
    async (request, reply): Promise<PricingHistoryResponse | { error: string }> => {
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

      const { days: rawDays } = request.query as { days?: string };
      const days = normalizeHistoryDays(rawDays);
      const cached = getCachedPricingHistory(database, item.id, days);

      if (cached.length > 0 && isHistoryCacheFresh(database, item.id, days)) {
        return {
          itemId: item.id,
          source: "pokemonpricetracker",
          days,
          points: cached,
          cached: true,
          message: "Loaded cached PokemonPriceTracker history."
        };
      }

      const sourceMatch = getPricingSourceMatch(database, item.id, "pokemonpricetracker");
      const sourceTcgPlayerId = getPokemonPriceTrackerTcgPlayerId(database, item.id);
      const points = await lookupPokemonPriceTrackerHistory({
        apiKey: config.pokemonPriceTrackerApiKey,
        item,
        days,
        sourceCardId: sourceTcgPlayerId ?? sourceMatch?.source_card_id ?? null
      }).catch((error) => {
        reply.code(statusCodeForPricingError(error));
        return {
          error:
            error instanceof Error
              ? error.message
              : "Unable to load PokemonPriceTracker price history."
        };
      });

      if ("error" in points) {
        return points;
      }

      savePricingHistory(database, item.id, points);

      return {
        itemId: item.id,
        source: "pokemonpricetracker",
        days,
        points,
        cached: false,
        message: points.length > 0 ? "Loaded PokemonPriceTracker history." : "No price history found."
      };
    }
  );

  app.get(
    "/api/collections/:collectionId/items/:itemId/pricing/snapshots",
    async (request, reply): Promise<MarketPriceSnapshotsResponse | { error: string }> => {
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

      return {
        itemId: item.id,
        snapshots: listMarketPriceSnapshots(database, item.id)
      };
    }
  );

  app.post(
    "/api/collections/:collectionId/items/:itemId/pricing/justtcg/refresh",
    async (request, reply) => {
      const access = getPricingAccess(request, database);

      if (!access.ok) {
        reply.code(access.statusCode);
        return { error: access.message };
      }

      reply.code(410);
      return { error: "JustTCG pricing is disabled. Use PokemonPriceTracker pricing." };
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

      reply.code(410);
      return { error: "JustTCG pricing is disabled. Use PokemonPriceTracker pricing." };
    }
  );

  app.post(
    "/api/collections/:collectionId/items/:itemId/pricing/pokemonpricetracker/refresh",
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

      if (item.itemType !== "graded") {
        reply.code(400);
        return {
          error: "PokemonPriceTracker graded pricing is only available for graded cards."
        };
      }

      const result = await lookupPokemonPriceTrackerPricing({
        apiKey: config.pokemonPriceTrackerApiKey,
        item
      }).catch((error) => {
        if (statusCodeForPricingError(error) === 429) {
          enqueueBulkPriceJob({
            database,
            collectionId: access.collectionId,
            itemId: item.id,
            mode: "graded",
            includeExisting: true,
            message: error instanceof Error ? error.message : "Rate limit reached."
          });

          return {
            status: "queued" as const,
            item: null,
            candidates: [],
            message:
              "PokemonPriceTracker rate limit reached. This card was added to the price queue.",
            queue: getBulkQueueResponse(
              database,
              access.collectionId,
              "Queued this card for later price refresh."
            )
          };
        }

        reply.code(statusCodeForPricingError(error));
        return {
          error:
            error instanceof Error
              ? error.message
              : "Unable to refresh PokemonPriceTracker pricing."
        };
      });

      if ("error" in result) {
        return result;
      }

      if (result.status === "queued") {
        return result;
      }

      if (result.status === "match") {
        saveMarketPrice(database, access.itemId, "pokemonpricetracker", result.candidate);
        const updatedItem = saveItemCardImageIfMissing(
          database,
          access.collectionId,
          access.itemId,
          imageUrlFromPricingCandidate(result.candidate)
        ) ?? getInventoryItem(database, access.collectionId, access.itemId);

        return {
          status: "saved",
          item: updatedItem,
          candidates: toPublicPokemonPriceTrackerCandidates(result.candidates),
          message: "Saved PokemonPriceTracker graded market price."
        };
      }

      const updatedItem = saveItemCardImageIfMissing(
        database,
        access.collectionId,
        access.itemId,
        result.cardImageUrl ?? null
      );

      return {
        status: "needs-review",
        item: updatedItem,
        candidates: toPublicPokemonPriceTrackerCandidates(result.candidates),
        message: result.message
      };
    }
  );

  app.post(
    "/api/collections/:collectionId/items/:itemId/pricing/pokemonpricetracker/select",
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

      if (item.itemType !== "graded") {
        reply.code(400);
        return {
          error: "PokemonPriceTracker graded pricing is only available for graded cards."
        };
      }

      const input = request.body as SelectPokemonPriceTrackerPricingRequest;
      const sourceCardId = input.sourceCardId?.trim();
      const sourceVariantId = input.sourceVariantId?.trim();

      if (!sourceCardId || !sourceVariantId) {
        reply.code(400);
        return { error: "Choose a PokemonPriceTracker card and grade before saving." };
      }

      const selectedCandidate = pokemonPriceTrackerCandidateFromSelection(
        input,
        sourceCardId,
        sourceVariantId
      );
      const candidate =
        selectedCandidate ??
        (await findPokemonPriceTrackerPricingCandidateByIds({
          apiKey: config.pokemonPriceTrackerApiKey,
          item,
          sourceCardId,
          sourceVariantId
        }).catch((error) => {
          reply.code(statusCodeForPricingError(error));
          return {
            error:
              error instanceof Error
                ? error.message
                : "Unable to save PokemonPriceTracker pricing."
          };
        }));

      if (candidate && "error" in candidate) {
        return candidate;
      }

      if (!candidate) {
        reply.code(404);
        return { error: "That PokemonPriceTracker price candidate is no longer available." };
      }

      saveMarketPrice(database, access.itemId, "pokemonpricetracker", candidate, "manual");
      const updatedItem = getInventoryItem(database, access.collectionId, access.itemId);

      return {
        status: "saved",
        item: updatedItem,
        candidates: [toPublicPokemonPriceTrackerCandidate(candidate)],
        message: "Saved selected PokemonPriceTracker graded market price."
      };
    }
  );

  app.get("/api/collections/:collectionId/pricing/bulk/queue", async (request, reply) => {
    const access = getCollectionPricingAccess(request, database);

    if (!access.ok) {
      reply.code(access.statusCode);
      return { error: access.message };
    }

    return getBulkQueueResponse(database, access.collectionId, "Bulk pricing queue loaded.");
  });

  app.post("/api/collections/:collectionId/pricing/bulk/queue", async (request, reply) => {
    const access = getCollectionPricingAccess(request, database);

    if (!access.ok) {
      reply.code(access.statusCode);
      return { error: access.message };
    }

    const input = request.body as EnqueueBulkPriceRefreshRequest;
    const itemIds = uniqueItemIds(input.itemIds);
    const mode = input.mode === "raw" || input.mode === "graded" ? input.mode : "auto";
    const includeExisting = Boolean(input.includeExisting);

    if (itemIds.length === 0) {
      reply.code(400);
      return { error: "Select at least one card before queueing price refreshes." };
    }

    const items = listInventoryItems(database, access.collectionId);
    const itemIdsInCollection = new Set(items.map((item) => item.id));
    const now = new Date().toISOString();

    database.connection.exec("BEGIN");
    try {
      for (const itemId of itemIds) {
        if (!itemIdsInCollection.has(itemId)) {
          continue;
        }

        insertBulkPriceJob({
          database,
          collectionId: access.collectionId,
          itemId,
          mode,
          includeExisting,
          message: null,
          now
        });
      }

      database.connection.exec("COMMIT");
    } catch (error) {
      database.connection.exec("ROLLBACK");
      throw error;
    }

    await processBulkPriceQueue({
      config,
      database,
      collectionId: access.collectionId
    });

    return getBulkQueueResponse(database, access.collectionId, "Queued selected price refreshes.");
  });

  app.post("/api/collections/:collectionId/pricing/bulk/queue/resume", async (request, reply) => {
    const access = getCollectionPricingAccess(request, database);

    if (!access.ok) {
      reply.code(access.statusCode);
      return { error: access.message };
    }

    await processBulkPriceQueue({
      config,
      database,
      collectionId: access.collectionId,
      ignoreNextAttemptAt: true
    });

    return getBulkQueueResponse(database, access.collectionId, "Bulk pricing queue resumed.");
  });

  app.post("/api/collections/:collectionId/pricing/bulk/queue/cancel", async (request, reply) => {
    const access = getCollectionPricingAccess(request, database);

    if (!access.ok) {
      reply.code(access.statusCode);
      return { error: access.message };
    }

    const now = new Date().toISOString();
    database.connection
      .prepare(
        `
          UPDATE bulk_price_queue
          SET
            status = 'cancelled',
            message = 'Cancelled by user.',
            finished_at = ?,
            updated_at = ?
          WHERE collection_id = ?
            AND status IN ('queued', 'running', 'rate-limited')
        `
      )
      .run(now, now, access.collectionId);

    return getBulkQueueResponse(database, access.collectionId, "Cancelled queued price refreshes.");
  });

  app.post("/api/collections/:collectionId/pricing/bulk/queue/retry-failed", async (request, reply) => {
    const access = getCollectionPricingAccess(request, database);

    if (!access.ok) {
      reply.code(access.statusCode);
      return { error: access.message };
    }

    const now = new Date().toISOString();
    database.connection
      .prepare(
        `
          UPDATE bulk_price_queue
          SET
            status = 'queued',
            message = 'Requeued failed price refresh.',
            next_attempt_at = NULL,
            started_at = NULL,
            finished_at = NULL,
            updated_at = ?
          WHERE collection_id = ?
            AND status = 'failed'
        `
      )
      .run(now, access.collectionId);

    await processBulkPriceQueue({
      config,
      database,
      collectionId: access.collectionId
    });

    return getBulkQueueResponse(database, access.collectionId, "Failed price refreshes were requeued.");
  });

  app.post("/api/collections/:collectionId/pricing/bulk/queue/clear-completed", async (request, reply) => {
    const access = getCollectionPricingAccess(request, database);

    if (!access.ok) {
      reply.code(access.statusCode);
      return { error: access.message };
    }

    database.connection
      .prepare(
        `
          DELETE FROM bulk_price_queue
          WHERE collection_id = ?
            AND status IN ('saved', 'needs-review', 'skipped', 'failed', 'cancelled')
        `
      )
      .run(access.collectionId);

    return getBulkQueueResponse(database, access.collectionId, "Cleared completed queue rows.");
  });

  app.post(
    "/api/collections/:collectionId/items/:itemId/pricing/ignore",
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

      setItemPriceRefreshIgnored(database, access.itemId, "Ignored from price queue.");
      skipOpenBulkPriceJobsForItem(database, access.collectionId, access.itemId);

      return getBulkQueueResponse(
        database,
        access.collectionId,
        "Ignored future queued price refreshes for this card."
      );
    }
  );
}

export function startBulkPriceQueueRunner(
  app: FastifyInstance,
  config: AppConfig,
  database: AppDatabase
) {
  resetStaleRunningBulkPriceJobs(database);

  const tick = async () => {
    try {
      if (
        config.scheduledPriceRefreshEnabled &&
        Boolean(config.pokemonPriceTrackerApiKey.trim())
      ) {
        enqueueScheduledPriceRefreshes(database, config);
      }

      const collectionIds = dueBulkPriceQueueCollectionIds(database);

      for (const collectionId of collectionIds) {
        await processBulkPriceQueue({
          config,
          database,
          collectionId
        });
      }
    } catch (error) {
      app.log.error({ error }, "Bulk price queue retry failed.");
    }
  };

  const startupTimer = setTimeout(() => {
    void tick();
  }, 5000);
  const interval = setInterval(() => {
    void tick();
  }, bulkPriceQueueIntervalMs);

  app.addHook("onClose", async () => {
    clearTimeout(startupTimer);
    clearInterval(interval);
  });
}

async function refreshPricingForItem({
  config,
  database,
  collectionId,
  item
}: {
  config: AppConfig;
  database: AppDatabase;
  collectionId: string;
  item: InventoryItem;
  includeQueueOnRateLimit?: boolean;
}) {
  // Saved PokemonPriceTracker IDs are safe direct-lookup hints for refreshes. A future
  // set-level cache warmer could use fetchAllInSet, but scored item-by-item matching
  // still protects variants, grades, Japanese cards, and review states.
  const preferredMatch = getPricingSourceMatch(database, item.id, "pokemonpricetracker");
  const preferredSourceCardId =
    preferredMatch?.source_card_id ?? pokemonPriceTrackerCardIdFromNotes(item.notes);

  if (item.itemType === "graded") {
    const result = await lookupPokemonPriceTrackerPricing({
      apiKey: config.pokemonPriceTrackerApiKey,
      item,
      preferredSourceCardId,
      preferredSourceVariantId: preferredMatch?.source_variant_id ?? null
    });

    if (result.status === "match") {
      saveMarketPrice(database, item.id, "pokemonpricetracker", result.candidate, "automatic");
      const updatedItem = saveItemCardImageIfMissing(
        database,
        collectionId,
        item.id,
        imageUrlFromPricingCandidate(result.candidate)
      ) ?? getInventoryItem(database, collectionId, item.id);

      return {
        status: "saved" as const,
        item: updatedItem,
        candidates: toPublicPricingCandidates(result.candidates, "pokemonpricetracker"),
        message: "Saved PokemonPriceTracker graded market price."
      };
    }

    const updatedItem = saveItemCardImageIfMissing(
      database,
      collectionId,
      item.id,
      result.cardImageUrl ?? null
    );

    return {
      status: "needs-review" as const,
      item: updatedItem,
      candidates: toPublicPricingCandidates(result.candidates, "pokemonpricetracker"),
      message: result.message
    };
      }

      clearItemPriceRefreshIgnored(database, item.id);

      const result = await lookupPokemonPriceTrackerPricing({
        apiKey: config.pokemonPriceTrackerApiKey,
        item,
    preferredSourceCardId,
    preferredSourceVariantId: preferredMatch?.source_variant_id ?? null
  });

  if (result.status === "match") {
    saveMarketPrice(database, item.id, "pokemonpricetracker", result.candidate, "automatic");
    const updatedItem = saveItemCardImageIfMissing(
      database,
      collectionId,
      item.id,
      imageUrlFromPricingCandidate(result.candidate)
    ) ?? getInventoryItem(database, collectionId, item.id);

    return {
      status: "saved" as const,
      item: updatedItem,
      candidates: toPublicPricingCandidates(result.candidates, "pokemonpricetracker"),
      message: "Saved PokemonPriceTracker raw market price."
    };
  }

  const updatedItem = saveItemCardImageIfMissing(
    database,
    collectionId,
    item.id,
    result.cardImageUrl ?? null
  );

  return {
    status: "needs-review" as const,
    item: updatedItem,
    candidates: toPublicPricingCandidates(result.candidates, "pokemonpricetracker"),
    message: result.message
  };
}

async function selectedPricingCandidate({
  config,
  input,
  item,
  source,
  sourceCardId,
  sourceVariantId
}: {
  config: AppConfig;
  input: SelectPricingRequest;
  item: InventoryItem;
  source: InventoryMarketPriceSource;
  sourceCardId: string;
  sourceVariantId: string;
}) {
  if (source === "justtcg") {
    throw new Error("JustTCG pricing is disabled. Use PokemonPriceTracker pricing.");
  }

  const selectedCandidate = pokemonPriceTrackerCandidateFromPricingSelection(
    input,
    sourceCardId,
    sourceVariantId
  );

  return (
    selectedCandidate ??
    (await findPokemonPriceTrackerPricingCandidateByIds({
      apiKey: config.pokemonPriceTrackerApiKey,
      item,
      sourceCardId,
      sourceVariantId
    }))
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

function getCollectionPricingAccess(request: FastifyRequest, database: AppDatabase) {
  const auth = getAuthContext(request, database);

  if (!auth) {
    return {
      ok: false as const,
      statusCode: 401,
      message: "Unauthorized"
    };
  }

  const { collectionId } = request.params as { collectionId: string };
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
    collectionId
  };
}

function getInventoryItem(database: AppDatabase, collectionId: string, itemId: string) {
  return listInventoryItems(database, collectionId).find((item) => item.id === itemId) ?? null;
}

function enqueueBulkPriceJob({
  database,
  collectionId,
  itemId,
  mode,
  includeExisting,
  message
}: {
  database: AppDatabase;
  collectionId: string;
  itemId: string;
  mode: BulkPriceQueueMode;
  includeExisting: boolean;
  message: string | null;
}) {
  const now = new Date().toISOString();
  return insertBulkPriceJob({
    database,
    collectionId,
    itemId,
    mode,
    includeExisting,
    message,
    now
  });
}

function enqueueScheduledPriceRefreshes(database: AppDatabase, config: AppConfig) {
  const rows = database.connection
    .prepare(
      `
        SELECT id
        FROM collections
        ORDER BY id
      `
    )
    .all() as { id: string }[];

  for (const row of rows) {
    enqueueScheduledPriceRefreshBatch({
      database,
      collectionId: row.id,
      intervalHours: config.priceRefreshIntervalHours,
      batchSize: config.priceRefreshBatchSize
    });
  }
}

function enqueueScheduledPriceRefreshBatch({
  database,
  collectionId,
  intervalHours,
  batchSize
}: {
  database: AppDatabase;
  collectionId: string;
  intervalHours: number;
  batchSize: number;
}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const state = getCollectionPriceRefreshState(database, collectionId);

  if (!state) {
    createCollectionPriceRefreshState(database, collectionId, nowIso);
  } else if (state.run_completed_at) {
    const completedAt = Date.parse(state.run_completed_at);
    const nextDueAt = completedAt + intervalHours * 60 * 60 * 1000;

    if (!Number.isNaN(completedAt) && nextDueAt > now.getTime()) {
      return;
    }

    startCollectionPriceRefreshRun(database, collectionId, nowIso);
  }

  const items = listInventoryItems(database, collectionId)
    .filter(isScheduledPriceRefreshEligible)
    .sort((left, right) => {
      const createdComparison = left.createdAt.localeCompare(right.createdAt);
      return createdComparison === 0 ? left.id.localeCompare(right.id) : createdComparison;
    });

  if (items.length === 0) {
    completeCollectionPriceRefreshRun(database, collectionId, nowIso);
    return;
  }

  const currentState = getCollectionPriceRefreshState(database, collectionId);
  const cursorIndex = currentState?.cursor_item_id
    ? items.findIndex((item) => item.id === currentState.cursor_item_id)
    : -1;
  let scannedIndex = cursorIndex + 1;
  let lastScannedItemId = currentState?.cursor_item_id ?? null;
  let insertedCount = 0;

  database.connection.exec("BEGIN");
  try {
    for (
      ;
      scannedIndex < items.length && insertedCount < batchSize;
      scannedIndex += 1
    ) {
      const item = items[scannedIndex];
      lastScannedItemId = item.id;

      if (isItemPriceRefreshIgnored(database, item.id)) {
        continue;
      }

      if (activeBulkPriceJobExists(database, collectionId, item.id)) {
        continue;
      }

      const inserted = insertBulkPriceJob({
        database,
        collectionId,
        itemId: item.id,
        mode: "auto",
        includeExisting: true,
        message: "Scheduled daily PokemonPriceTracker refresh.",
        now: nowIso
      });

      if (inserted) {
        insertedCount += 1;
      }
    }

    if (scannedIndex >= items.length) {
      completeCollectionPriceRefreshRun(database, collectionId, nowIso);
    } else {
      updateCollectionPriceRefreshCursor(database, collectionId, lastScannedItemId, nowIso);
    }

    database.connection.exec("COMMIT");
  } catch (error) {
    database.connection.exec("ROLLBACK");
    throw error;
  }
}

type CollectionPriceRefreshStateRow = {
  collection_id: string;
  run_started_at: string | null;
  run_completed_at: string | null;
  cursor_item_id: string | null;
  updated_at: string;
};

function getCollectionPriceRefreshState(database: AppDatabase, collectionId: string) {
  return database.connection
    .prepare(
      `
        SELECT collection_id, run_started_at, run_completed_at, cursor_item_id, updated_at
        FROM collection_price_refresh_state
        WHERE collection_id = ?
      `
    )
    .get(collectionId) as CollectionPriceRefreshStateRow | undefined;
}

function createCollectionPriceRefreshState(
  database: AppDatabase,
  collectionId: string,
  now: string
) {
  database.connection
    .prepare(
      `
        INSERT INTO collection_price_refresh_state (
          collection_id,
          run_started_at,
          run_completed_at,
          cursor_item_id,
          updated_at
        )
        VALUES (?, ?, NULL, NULL, ?)
      `
    )
    .run(collectionId, now, now);
}

function startCollectionPriceRefreshRun(
  database: AppDatabase,
  collectionId: string,
  now: string
) {
  database.connection
    .prepare(
      `
        UPDATE collection_price_refresh_state
        SET
          run_started_at = ?,
          run_completed_at = NULL,
          cursor_item_id = NULL,
          updated_at = ?
        WHERE collection_id = ?
      `
    )
    .run(now, now, collectionId);
}

function updateCollectionPriceRefreshCursor(
  database: AppDatabase,
  collectionId: string,
  cursorItemId: string | null,
  now: string
) {
  database.connection
    .prepare(
      `
        UPDATE collection_price_refresh_state
        SET
          cursor_item_id = ?,
          updated_at = ?
        WHERE collection_id = ?
      `
    )
    .run(cursorItemId, now, collectionId);
}

function completeCollectionPriceRefreshRun(
  database: AppDatabase,
  collectionId: string,
  now: string
) {
  database.connection
    .prepare(
      `
        UPDATE collection_price_refresh_state
        SET
          run_completed_at = ?,
          cursor_item_id = NULL,
          updated_at = ?
        WHERE collection_id = ?
      `
    )
    .run(now, now, collectionId);
}

function isScheduledPriceRefreshEligible(item: InventoryItem) {
  return item.itemType === "raw" || item.itemType === "graded";
}

function activeBulkPriceJobExists(
  database: AppDatabase,
  collectionId: string,
  itemId: string
) {
  const row = database.connection
    .prepare(
      `
        SELECT id
        FROM bulk_price_queue
        WHERE collection_id = ?
          AND owned_item_id = ?
          AND status IN ('queued', 'running', 'rate-limited')
        LIMIT 1
      `
    )
    .get(collectionId, itemId) as { id: string } | undefined;

  return Boolean(row);
}

function isItemPriceRefreshIgnored(database: AppDatabase, itemId: string) {
  const row = database.connection
    .prepare(
      `
        SELECT owned_item_id
        FROM item_price_refresh_ignores
        WHERE owned_item_id = ?
      `
    )
    .get(itemId) as { owned_item_id: string } | undefined;

  return Boolean(row);
}

function setItemPriceRefreshIgnored(database: AppDatabase, itemId: string, reason: string) {
  database.connection
    .prepare(
      `
        INSERT INTO item_price_refresh_ignores (
          owned_item_id,
          reason,
          ignored_at
        )
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(owned_item_id) DO UPDATE SET
          reason = excluded.reason,
          ignored_at = CURRENT_TIMESTAMP
      `
    )
    .run(itemId, reason);
}

function clearItemPriceRefreshIgnored(database: AppDatabase, itemId: string) {
  database.connection
    .prepare("DELETE FROM item_price_refresh_ignores WHERE owned_item_id = ?")
    .run(itemId);
}

function skipOpenBulkPriceJobsForItem(
  database: AppDatabase,
  collectionId: string,
  itemId: string
) {
  const now = new Date().toISOString();

  database.connection
    .prepare(
      `
        UPDATE bulk_price_queue
        SET
          status = 'skipped',
          message = 'Ignored for future queued price refreshes.',
          next_attempt_at = NULL,
          finished_at = ?,
          updated_at = ?
        WHERE collection_id = ?
          AND owned_item_id = ?
          AND status IN ('queued', 'needs-review', 'rate-limited', 'failed')
      `
    )
    .run(now, now, collectionId, itemId);
}

function insertBulkPriceJob({
  database,
  collectionId,
  itemId,
  mode,
  includeExisting,
  message,
  now
}: {
  database: AppDatabase;
  collectionId: string;
  itemId: string;
  mode: BulkPriceQueueMode;
  includeExisting: boolean;
  message: string | null;
  now: string;
}) {
  if (isItemPriceRefreshIgnored(database, itemId)) {
    return false;
  }

  database.connection
    .prepare(
      `
        INSERT INTO bulk_price_queue (
          id,
          collection_id,
          owned_item_id,
          mode,
          status,
          attempts,
          include_existing,
          message,
          next_attempt_at,
          started_at,
          finished_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, NULL, NULL, NULL, ?, ?)
      `
    )
    .run(randomUUID(), collectionId, itemId, mode, includeExisting ? 1 : 0, message, now, now);

  return true;
}

type BulkPriceQueueRow = {
  id: string;
  collection_id: string;
  owned_item_id: string;
  mode: BulkPriceQueueMode;
  status: BulkPriceQueueStatus;
  attempts: number;
  include_existing: number;
  message: string | null;
  next_attempt_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

async function processBulkPriceQueue({
  config,
  database,
  collectionId,
  ignoreNextAttemptAt = false
}: {
  config: AppConfig;
  database: AppDatabase;
  collectionId: string;
  ignoreNextAttemptAt?: boolean;
}) {
  const maxJobsPerRun = 50;

  if (activeBulkPriceQueueCollections.has(collectionId)) {
    return;
  }

  activeBulkPriceQueueCollections.add(collectionId);
  try {
    for (let index = 0; index < maxJobsPerRun; index += 1) {
      const job = nextBulkPriceJob(database, collectionId, ignoreNextAttemptAt);

      if (!job) {
        return;
      }

      const result = await processBulkPriceJob({ config, database, collectionId, job });

      if (result === "rate-limited") {
        return;
      }
    }
  } finally {
    activeBulkPriceQueueCollections.delete(collectionId);
  }
}

function dueBulkPriceQueueCollectionIds(database: AppDatabase) {
  const now = new Date().toISOString();
  const rows = database.connection
    .prepare(
      `
        SELECT DISTINCT collection_id
        FROM bulk_price_queue
        WHERE status = 'queued'
          OR (status = 'rate-limited' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?)
        ORDER BY collection_id
      `
    )
    .all(now) as { collection_id: string }[];

  return rows.map((row) => row.collection_id);
}

function resetStaleRunningBulkPriceJobs(database: AppDatabase) {
  const now = new Date().toISOString();

  database.connection
    .prepare(
      `
        UPDATE bulk_price_queue
        SET
          status = 'queued',
          message = 'Resumed after API restart.',
          next_attempt_at = NULL,
          updated_at = ?
        WHERE status = 'running'
      `
    )
    .run(now);
}

function nextBulkPriceJob(
  database: AppDatabase,
  collectionId: string,
  ignoreNextAttemptAt: boolean
) {
  const now = new Date().toISOString();
  const rows = database.connection
    .prepare(
      `
        SELECT *
        FROM bulk_price_queue
        WHERE collection_id = ?
          AND status IN ('queued', 'rate-limited')
        ORDER BY created_at ASC
      `
    )
    .all(collectionId) as BulkPriceQueueRow[];

  return (
    rows.find((row) => ignoreNextAttemptAt || !row.next_attempt_at || row.next_attempt_at <= now) ??
    null
  );
}

async function processBulkPriceJob({
  config,
  database,
  collectionId,
  job
}: {
  config: AppConfig;
  database: AppDatabase;
  collectionId: string;
  job: BulkPriceQueueRow;
}) {
  const startedAt = new Date().toISOString();
  markBulkPriceJobRunning(database, job.id, startedAt);

  const item = getInventoryItem(database, collectionId, job.owned_item_id);

  if (!item) {
    finishBulkPriceJob(database, job.id, "skipped", "Inventory item no longer exists.");
    return "done";
  }

  if (isItemPriceRefreshIgnored(database, item.id)) {
    finishBulkPriceJob(
      database,
      job.id,
      "skipped",
      "Skipped because queued price refreshes are ignored for this card."
    );
    return "done";
  }

  if (!job.include_existing && item.marketPriceCents !== null) {
    finishBulkPriceJob(database, job.id, "skipped", "Skipped because this item already has a market price.");
    return "done";
  }

  const source = sourceForBulkPriceJob(job.mode, item);

  if (source === "skip") {
    finishBulkPriceJob(database, job.id, "skipped", "Skipped because this item type does not match the selected pricing mode.");
    return "done";
  }

  try {
    const result = await refreshPricingForItem({
      config,
      database,
      collectionId,
      item
    });

    if (result.status === "saved") {
      finishBulkPriceJob(database, job.id, "saved", result.message);
    } else {
      finishBulkPriceJob(database, job.id, "needs-review", result.message);
    }

    return "done";
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to refresh market price for this item.";

    if (statusCodeForPricingError(error) === 429) {
      pauseBulkPriceJobForRateLimit(database, job.id, message);
      return "rate-limited";
    }

    finishBulkPriceJob(database, job.id, "failed", message);
    return "done";
  }
}

function sourceForBulkPriceJob(mode: BulkPriceQueueMode, item: InventoryItem) {
  if (mode === "raw") {
    return item.itemType === "raw" ? "raw" : "skip";
  }

  if (mode === "graded") {
    return item.itemType === "graded" ? "graded" : "skip";
  }

  return item.itemType;
}

function markBulkPriceJobRunning(database: AppDatabase, jobId: string, startedAt: string) {
  database.connection
    .prepare(
      `
        UPDATE bulk_price_queue
        SET
          status = 'running',
          attempts = attempts + 1,
          started_at = ?,
          next_attempt_at = NULL,
          updated_at = ?
        WHERE id = ?
      `
    )
    .run(startedAt, startedAt, jobId);
}

function finishBulkPriceJob(
  database: AppDatabase,
  jobId: string,
  status: Exclude<BulkPriceQueueStatus, "queued" | "running" | "rate-limited">,
  message: string
) {
  const now = new Date().toISOString();

  database.connection
    .prepare(
      `
        UPDATE bulk_price_queue
        SET
          status = ?,
          message = ?,
          finished_at = ?,
          next_attempt_at = NULL,
          updated_at = ?
        WHERE id = ?
      `
    )
    .run(status, message, now, now, jobId);
}

function pauseBulkPriceJobForRateLimit(database: AppDatabase, jobId: string, message: string) {
  const now = new Date();
  const nextAttemptAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  database.connection
    .prepare(
      `
        UPDATE bulk_price_queue
        SET
          status = 'rate-limited',
          message = ?,
          next_attempt_at = ?,
          updated_at = ?
        WHERE id = ?
      `
    )
    .run(message, nextAttemptAt, nowIso, jobId);
}

function saveMarketPrice(
  database: AppDatabase,
  itemId: string,
  source: "pokemonpricetracker",
  candidate: PokemonPriceTrackerPricingCandidateWithPayload,
  matchKind: "automatic" | "manual" = "automatic"
) {
  const lookedUpAt = new Date().toISOString();
  const previousPriceCents = getCurrentMarketPriceCents(database, itemId);

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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, CURRENT_TIMESTAMP)
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
      source,
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

  insertMarketPriceSnapshot(database, itemId, source, candidate, previousPriceCents, lookedUpAt);
  savePricingSourceMatch(database, itemId, source, candidate, matchKind);
  markBulkPriceJobsSolvedForItem(database, itemId, candidate);
}

function getCurrentMarketPriceCents(database: AppDatabase, itemId: string) {
  const row = database.connection
    .prepare(
      `
        SELECT price_cents
        FROM item_market_prices
        WHERE owned_item_id = ?
      `
    )
    .get(itemId) as { price_cents: number | null } | undefined;

  return Number.isFinite(row?.price_cents) ? row?.price_cents ?? null : null;
}

function insertMarketPriceSnapshot(
  database: AppDatabase,
  itemId: string,
  source: "pokemonpricetracker",
  candidate: PokemonPriceTrackerPricingCandidateWithPayload,
  previousPriceCents: number | null,
  capturedAt: string
) {
  const deltaCents =
    previousPriceCents === null ? null : candidate.priceCents - previousPriceCents;

  database.connection
    .prepare(
      `
        INSERT INTO item_market_price_snapshots (
          id,
          owned_item_id,
          source,
          price_kind,
          source_card_id,
          source_variant_id,
          matched_name,
          matched_set_name,
          matched_card_number,
          price_cents,
          previous_price_cents,
          delta_cents,
          confidence,
          captured_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      randomUUID(),
      itemId,
      source,
      candidate.priceKind,
      candidate.sourceCardId,
      candidate.sourceVariantId,
      candidate.matchedName,
      candidate.matchedSetName,
      candidate.matchedCardNumber,
      candidate.priceCents,
      previousPriceCents,
      deltaCents,
      candidate.confidence,
      capturedAt
    );
}

function markBulkPriceJobsSolvedForItem(
  database: AppDatabase,
  itemId: string,
  candidate: PokemonPriceTrackerPricingCandidateWithPayload
) {
  const now = new Date().toISOString();
  const kindLabel = candidate.priceKind === "graded" ? "graded" : "raw";

  database.connection
    .prepare(
      `
        UPDATE bulk_price_queue
        SET
          status = 'saved',
          message = ?,
          finished_at = COALESCE(finished_at, ?),
          next_attempt_at = NULL,
          updated_at = ?
        WHERE owned_item_id = ?
          AND status IN ('queued', 'running', 'needs-review', 'rate-limited', 'failed')
      `
    )
    .run(`Saved PokemonPriceTracker ${kindLabel} market price.`, now, now, itemId);
}

function saveItemCardImageIfMissing(
  database: AppDatabase,
  collectionId: string,
  itemId: string,
  imageUrl: string | null
) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    return null;
  }

  const row = database.connection
    .prepare(
      `
        SELECT oi.card_id, c.image_url
        FROM owned_items oi
        JOIN cards c ON c.id = oi.card_id
        WHERE oi.id = ? AND oi.collection_id = ?
      `
    )
    .get(itemId, collectionId) as { card_id: string; image_url: string | null } | undefined;

  if (!row) {
    return null;
  }

  if (!row.image_url) {
    database.connection
      .prepare(
        `
          UPDATE cards
          SET image_url = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
      )
      .run(imageUrl, row.card_id);
  }

  return getInventoryItem(database, collectionId, itemId);
}

function imageUrlFromPricingCandidate(candidate: PokemonPriceTrackerPricingCandidateWithPayload) {
  if (!candidate.rawPayload || typeof candidate.rawPayload !== "object") {
    return null;
  }

  const card = (candidate.rawPayload as { card?: unknown }).card;

  if (!card || typeof card !== "object") {
    return null;
  }

  const record = card as {
    imageUrl?: unknown;
  };

  return typeof record.imageUrl === "string" ? record.imageUrl : null;
}

function savePricingSourceMatch(
  database: AppDatabase,
  itemId: string,
  source: InventoryMarketPriceSource,
  candidate: PokemonPriceTrackerPricingCandidateWithPayload,
  matchKind: "automatic" | "manual"
) {
  database.connection
    .prepare(
      `
        INSERT INTO item_price_source_matches (
          owned_item_id,
          source,
          source_card_id,
          source_variant_id,
          match_kind,
          confidence,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(owned_item_id, source) DO UPDATE SET
          source_card_id = excluded.source_card_id,
          source_variant_id = excluded.source_variant_id,
          match_kind = excluded.match_kind,
          confidence = excluded.confidence,
          updated_at = CURRENT_TIMESTAMP
      `
    )
    .run(
      itemId,
      source,
      candidate.sourceCardId,
      candidate.sourceVariantId,
      matchKind,
      candidate.confidence
    );
}

type PricingSourceMatchRow = {
  source_card_id: string;
  source_variant_id: string;
  match_kind: "automatic" | "manual";
  confidence: "exact" | "strong" | "possible";
};

function getPricingSourceMatch(
  database: AppDatabase,
  itemId: string,
  source: InventoryMarketPriceSource
) {
  return database.connection
    .prepare(
      `
        SELECT source_card_id, source_variant_id, match_kind, confidence
        FROM item_price_source_matches
        WHERE owned_item_id = ? AND source = ?
      `
    )
    .get(itemId, source) as PricingSourceMatchRow | undefined;
}

function pokemonPriceTrackerCardIdFromNotes(notes: string | null | undefined) {
  const match = String(notes ?? "").match(/\bPokemonPriceTracker card ([a-z0-9-]{4,})\b/i);

  return match?.[1] ?? null;
}

function getPokemonPriceTrackerTcgPlayerId(database: AppDatabase, itemId: string) {
  const row = database.connection
    .prepare(
      `
        SELECT raw_payload
        FROM item_market_prices
        WHERE owned_item_id = ?
          AND source = 'pokemonpricetracker'
      `
    )
    .get(itemId) as { raw_payload: string } | undefined;

  if (!row?.raw_payload) {
    return null;
  }

  const payload = parseJsonRecord(row.raw_payload);

  if (!payload) {
    return null;
  }

  const card = payload.card;

  if (!isObjectRecord(card)) {
    return null;
  }

  const tcgPlayerId = card.tcgPlayerId;

  return typeof tcgPlayerId === "string" || typeof tcgPlayerId === "number"
    ? String(tcgPlayerId)
    : null;
}

function parseJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHistoryDays(rawDays: string | undefined) {
  const days = Number(rawDays ?? 30);

  if (days <= 7) {
    return 7;
  }

  if (days <= 30) {
    return 30;
  }

  return 90;
}

function getCachedPricingHistory(database: AppDatabase, itemId: string, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = database.connection
    .prepare(
      `
        SELECT source, price_kind, history_date, price_cents
        FROM item_price_history
        WHERE owned_item_id = ?
          AND source = 'pokemonpricetracker'
          AND history_date >= ?
        ORDER BY history_date ASC
      `
    )
    .all(itemId, cutoff) as {
    source: InventoryMarketPriceSource;
    price_kind: "raw" | "graded";
    history_date: string;
    price_cents: number;
  }[];

  return rows.map((row) => ({
    date: row.history_date,
    priceCents: row.price_cents,
    source: row.source,
    priceKind: row.price_kind
  }));
}

function isHistoryCacheFresh(database: AppDatabase, itemId: string, days: number) {
  const newest = database.connection
    .prepare(
      `
        SELECT MAX(updated_at) AS updated_at
        FROM item_price_history
        WHERE owned_item_id = ?
          AND source = 'pokemonpricetracker'
      `
    )
    .get(itemId) as { updated_at: string | null } | undefined;

  if (!newest?.updated_at) {
    return false;
  }

  const updatedAt = new Date(newest.updated_at).getTime();
  const maxAgeMs = days <= 7 ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  return Number.isFinite(updatedAt) && Date.now() - updatedAt < maxAgeMs;
}

function savePricingHistory(
  database: AppDatabase,
  itemId: string,
  points: PricingHistoryPoint[]
) {
  const statement = database.connection.prepare(
    `
      INSERT INTO item_price_history (
        owned_item_id,
        source,
        price_kind,
        history_date,
        price_cents,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(owned_item_id, source, price_kind, history_date) DO UPDATE SET
        price_cents = excluded.price_cents,
        updated_at = CURRENT_TIMESTAMP
    `
  );

  database.connection.exec("BEGIN");
  try {
    for (const point of points) {
      statement.run(itemId, point.source, point.priceKind, point.date, point.priceCents);
    }

    database.connection.exec("COMMIT");
  } catch (error) {
    database.connection.exec("ROLLBACK");
    throw error;
  }
}

function listMarketPriceSnapshots(database: AppDatabase, itemId: string): MarketPriceSnapshot[] {
  const rows = database.connection
    .prepare(
      `
        SELECT
          id,
          owned_item_id,
          source,
          price_kind,
          source_card_id,
          source_variant_id,
          matched_name,
          matched_set_name,
          matched_card_number,
          price_cents,
          previous_price_cents,
          delta_cents,
          confidence,
          captured_at
        FROM (
          SELECT *
          FROM item_market_price_snapshots
          WHERE owned_item_id = ?
          ORDER BY captured_at DESC, created_at DESC
          LIMIT 100
        )
        ORDER BY captured_at ASC, created_at ASC
      `
    )
    .all(itemId) as {
    id: string;
    owned_item_id: string;
    source: InventoryMarketPriceSource;
    price_kind: "raw" | "graded";
    source_card_id: string;
    source_variant_id: string;
    matched_name: string;
    matched_set_name: string | null;
    matched_card_number: string | null;
    price_cents: number;
    previous_price_cents: number | null;
    delta_cents: number | null;
    confidence: "exact" | "strong" | "possible";
    captured_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    itemId: row.owned_item_id,
    source: row.source,
    priceKind: row.price_kind,
    sourceCardId: row.source_card_id,
    sourceVariantId: row.source_variant_id,
    matchedName: row.matched_name,
    matchedSetName: row.matched_set_name,
    matchedCardNumber: row.matched_card_number,
    priceCents: row.price_cents,
    previousPriceCents: row.previous_price_cents,
    deltaCents: row.delta_cents,
    confidence: row.confidence,
    capturedAt: row.captured_at
  }));
}

function toPublicPricingCandidates(
  candidates: PokemonPriceTrackerPricingCandidateWithPayload[],
  source: InventoryMarketPriceSource
) {
  return candidates.map((candidate) => toPublicPricingCandidate(candidate, source));
}

function toPublicPricingCandidate(
  candidate: PokemonPriceTrackerPricingCandidateWithPayload,
  source: InventoryMarketPriceSource
): PricingCandidate {
  if (source === "pokemonpricetracker") {
    return toPublicPokemonPriceTrackerCandidate(candidate);
  }

  throw new Error("JustTCG pricing is disabled. Use PokemonPriceTracker pricing.");
}

function toPublicPokemonPriceTrackerCandidates(
  candidates: PokemonPriceTrackerPricingCandidateWithPayload[]
) {
  return candidates.map(toPublicPokemonPriceTrackerCandidate);
}

function toPublicPokemonPriceTrackerCandidate(
  candidate: PokemonPriceTrackerPricingCandidateWithPayload
): PokemonPriceTrackerPricingCandidate {
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
    score: candidate.score,
    source: "pokemonpricetracker",
    priceKind: candidate.priceKind,
    grader: candidate.grader,
    grade: candidate.grade,
    gradeBucket: candidate.gradeBucket,
    saleCount: candidate.saleCount,
    averagePriceCents: candidate.averagePriceCents,
    medianPriceCents: candidate.medianPriceCents,
    minPriceCents: candidate.minPriceCents,
    maxPriceCents: candidate.maxPriceCents,
    marketTrend: candidate.marketTrend,
    historyAvailable: candidate.historyAvailable
  };
}

function pokemonPriceTrackerCandidateFromSelection(
  input: SelectPokemonPriceTrackerPricingRequest,
  sourceCardId: string,
  sourceVariantId: string
): PokemonPriceTrackerPricingCandidateWithPayload | null {
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

function pokemonPriceTrackerCandidateFromPricingSelection(
  input: SelectPricingRequest,
  sourceCardId: string,
  sourceVariantId: string
): PokemonPriceTrackerPricingCandidateWithPayload | null {
  if (
    !input.candidate ||
    input.candidate.source !== "pokemonpricetracker" ||
    input.candidate.sourceCardId !== sourceCardId ||
    input.candidate.sourceVariantId !== sourceVariantId
  ) {
    return null;
  }

  return {
    ...input.candidate,
    source: "pokemonpricetracker",
    rawPayload: {
      selectedCandidate: input.candidate
    }
  };
}

function getBulkQueueResponse(
  database: AppDatabase,
  collectionId: string,
  message: string
): BulkPriceQueueResponse {
  const rows = database.connection
    .prepare(
      `
        SELECT *
        FROM bulk_price_queue
        WHERE collection_id = ?
        ORDER BY created_at DESC
        LIMIT 100
      `
    )
    .all(collectionId) as BulkPriceQueueRow[];
  const itemsById = new Map(
    listInventoryItems(database, collectionId).map((item) => [item.id, item])
  );
  const jobs = rows.map((row) => toPublicBulkPriceJob(row, itemsById.get(row.owned_item_id) ?? null));

  return {
    jobs,
    summary: summarizeBulkPriceJobs(jobs),
    message
  };
}

function toPublicBulkPriceJob(
  row: BulkPriceQueueRow,
  item: InventoryItem | null
): BulkPriceQueueJob {
  return {
    id: row.id,
    collectionId: row.collection_id,
    itemId: row.owned_item_id,
    mode: row.mode,
    status: row.status,
    attempts: row.attempts,
    includeExisting: row.include_existing === 1,
    message: row.message,
    nextAttemptAt: row.next_attempt_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    item
  };
}

function summarizeBulkPriceJobs(jobs: BulkPriceQueueJob[]) {
  return jobs.reduce(
    (summary, job) => {
      summary.total += 1;

      if (job.status === "needs-review") {
        summary.needsReview += 1;
      } else if (job.status === "rate-limited") {
        summary.rateLimited += 1;
      } else {
        summary[job.status] += 1;
      }

      return summary;
    },
    {
      total: 0,
      queued: 0,
      running: 0,
      saved: 0,
      needsReview: 0,
      skipped: 0,
      rateLimited: 0,
      failed: 0,
      cancelled: 0
    }
  );
}

function uniqueItemIds(itemIds: string[] | undefined) {
  const seen = new Set<string>();

  return (Array.isArray(itemIds) ? itemIds : [])
    .map((itemId) => String(itemId).trim())
    .filter((itemId) => {
      if (!itemId || seen.has(itemId)) {
        return false;
      }

      seen.add(itemId);
      return true;
    });
}

function statusCodeForPricingError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("rate limit")) {
    return 429;
  }

  if (message.includes("JustTCG pricing is disabled")) {
    return 400;
  }

  if (message.includes("POKEMON_PRICE_TRACKER_API_KEY")) {
    return 400;
  }

  return 502;
}
