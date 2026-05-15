import type { FastifyInstance } from "fastify";
import {
  createCollection,
  createCollectionInvite,
  getAuthContext,
  getCollectionRole,
  listCollectionsForUser,
  validateEmail
} from "../auth.js";
import type { AppDatabase } from "../db.js";

type CreateCollectionBody = {
  name?: string;
  defaultLocale?: "en" | "ja";
};

type CreateInviteBody = {
  email?: string;
  role?: "admin" | "editor" | "viewer";
};

export async function registerCollectionRoutes(app: FastifyInstance, database: AppDatabase) {
  app.get("/api/collections", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    return {
      collections: listCollectionsForUser(database, auth.user.id)
    };
  });

  app.post("/api/collections", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const body = request.body as CreateCollectionBody;
    const name = body.name?.trim() ?? "";
    const defaultLocale = body.defaultLocale ?? "en";

    if (name.length < 2) {
      reply.code(400);
      throw new Error("Collection name must be at least 2 characters.");
    }

    if (!["en", "ja"].includes(defaultLocale)) {
      reply.code(400);
      throw new Error("Default locale must be en or ja.");
    }

    return {
      collection: createCollection(database, {
        ownerUserId: auth.user.id,
        name,
        defaultLocale
      })
    };
  });

  app.post("/api/collections/:collectionId/invites", async (request, reply) => {
    const auth = getAuthContext(request, database);

    if (!auth) {
      reply.code(401);
      return { error: "Unauthorized" };
    }

    const params = request.params as { collectionId: string };
    const role = getCollectionRole(database, params.collectionId, auth.user.id);

    if (role !== "owner" && role !== "admin") {
      reply.code(403);
      return { error: "Only collection owners and admins can invite members." };
    }

    const body = request.body as CreateInviteBody;
    const email = body.email ?? "";
    const inviteRole = body.role ?? "viewer";

    if (!validateEmail(email)) {
      reply.code(400);
      throw new Error("Enter a valid invite email.");
    }

    if (!["admin", "editor", "viewer"].includes(inviteRole)) {
      reply.code(400);
      throw new Error("Invite role must be admin, editor, or viewer.");
    }

    return {
      invite: createCollectionInvite(database, {
        collectionId: params.collectionId,
        email,
        role: inviteRole,
        createdByUserId: auth.user.id
      })
    };
  });
}

