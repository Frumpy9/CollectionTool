import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AddCollectionMemberRequest,
  AdminCollectionStatusResponse,
  AdminIgnoredPriceRefreshItem,
  AdminUser,
  AdminUsersResponse,
  BulkPriceQueueResponse,
  CollectionMemberCandidate,
  CollectionMember,
  CollectionMembersResponse,
  CreateAdminUserRequest,
  ResetAdminUserPasswordRequest,
  UpdateAdminUserRequest,
  UpdateCollectionMemberRequest
} from "@collection-tool/shared";
import {
  canManageCollection,
  getAuthContext,
  hashPassword,
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validateUsername
} from "../auth.js";
import { listSqliteBackups } from "../backups.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";

const collectionRoles = ["admin", "editor", "viewer"] as const;

type CollectionRole = (typeof collectionRoles)[number];

type AdminUserRow = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  system_role: "admin" | "user";
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  collection_count: number;
  active_session_count: number;
};

type CollectionMemberRow = {
  user_id: string;
  email: string;
  username: string;
  display_name: string;
  system_role: "admin" | "user";
  disabled_at: string | null;
  role: "owner" | "admin" | "editor" | "viewer";
  created_at: string;
  owner_user_id: string;
};

export async function registerAdminRoutes(
  app: FastifyInstance,
  config: AppConfig,
  database: AppDatabase
) {
  app.get("/api/admin/users", async (request, reply): Promise<AdminUsersResponse | { error: string }> => {
    const auth = requireSystemAdmin(request, reply, database);

    if (!auth) {
      return { error: "Unauthorized" };
    }

    return { users: listAdminUsers(database) };
  });

  app.post("/api/admin/users", async (request, reply): Promise<{ user: AdminUser } | { error: string }> => {
    const auth = requireSystemAdmin(request, reply, database);

    if (!auth) {
      return { error: "Unauthorized" };
    }

    const body = request.body as CreateAdminUserRequest;
    const email = normalizeEmail(body.email ?? "");
    const username = normalizeUsername(body.username ?? "");
    const displayName = body.displayName?.trim() ?? "";
    const password = body.password ?? "";
    const systemRole = body.systemRole ?? "user";

    validateUserInput({ reply, email, username, displayName, systemRole });
    validatePassword(reply, password);
    ensureUserIdentityAvailable(database, reply, { email, username });

    const { hash, salt } = hashPassword(password);
    const userId = randomUUID();

    database.connection
      .prepare(
        `
          INSERT INTO users (
            id,
            email,
            username,
            display_name,
            password_hash,
            password_salt,
            system_role
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(userId, email, username, displayName, hash, salt, systemRole);

    return { user: getAdminUser(database, userId)! };
  });

  app.patch(
    "/api/admin/users/:userId",
    async (request, reply): Promise<{ user: AdminUser } | { error: string }> => {
      const auth = requireSystemAdmin(request, reply, database);

      if (!auth) {
        return { error: "Unauthorized" };
      }

      const { userId } = request.params as { userId: string };
      const existing = getAdminUser(database, userId);

      if (!existing) {
        reply.code(404);
        return { error: "User not found." };
      }

      const body = request.body as UpdateAdminUserRequest;
      const email = body.email === undefined ? existing.email : normalizeEmail(body.email);
      const username =
        body.username === undefined ? existing.username : normalizeUsername(body.username);
      const displayName =
        body.displayName === undefined ? existing.displayName : body.displayName.trim();
      const systemRole = body.systemRole ?? existing.systemRole;

      validateUserInput({ reply, email, username, displayName, systemRole });
      ensureUserIdentityAvailable(database, reply, { email, username, excludeUserId: userId });

      if (
        existing.systemRole === "admin" &&
        systemRole !== "admin" &&
        existing.disabledAt === null &&
        enabledSystemAdminCount(database) <= 1
      ) {
        reply.code(400);
        return { error: "Keep at least one enabled system admin." };
      }

      database.connection
        .prepare(
          `
            UPDATE users
            SET
              email = ?,
              username = ?,
              display_name = ?,
              system_role = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `
        )
        .run(email, username, displayName, systemRole, userId);

      return { user: getAdminUser(database, userId)! };
    }
  );

  app.post(
    "/api/admin/users/:userId/password",
    async (request, reply): Promise<{ user: AdminUser } | { error: string }> => {
      const auth = requireSystemAdmin(request, reply, database);

      if (!auth) {
        return { error: "Unauthorized" };
      }

      const { userId } = request.params as { userId: string };
      const existing = getAdminUser(database, userId);

      if (!existing) {
        reply.code(404);
        return { error: "User not found." };
      }

      const body = request.body as ResetAdminUserPasswordRequest;
      validatePassword(reply, body.password ?? "");

      const { hash, salt } = hashPassword(body.password);

      database.connection
        .prepare(
          `
            UPDATE users
            SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `
        )
        .run(hash, salt, userId);

      database.connection.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);

      return { user: getAdminUser(database, userId)! };
    }
  );

  app.post(
    "/api/admin/users/:userId/disable",
    async (request, reply): Promise<{ user: AdminUser } | { error: string }> => {
      const auth = requireSystemAdmin(request, reply, database);

      if (!auth) {
        return { error: "Unauthorized" };
      }

      const { userId } = request.params as { userId: string };
      const existing = getAdminUser(database, userId);

      if (!existing) {
        reply.code(404);
        return { error: "User not found." };
      }

      if (
        existing.systemRole === "admin" &&
        existing.disabledAt === null &&
        enabledSystemAdminCount(database) <= 1
      ) {
        reply.code(400);
        return { error: "Keep at least one enabled system admin." };
      }

      database.connection.exec("BEGIN");
      try {
        database.connection
          .prepare(
            `
              UPDATE users
              SET disabled_at = COALESCE(disabled_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `
          )
          .run(userId);
        database.connection.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
        database.connection.exec("COMMIT");
      } catch (error) {
        database.connection.exec("ROLLBACK");
        throw error;
      }

      return { user: getAdminUser(database, userId)! };
    }
  );

  app.post(
    "/api/admin/users/:userId/enable",
    async (request, reply): Promise<{ user: AdminUser } | { error: string }> => {
      const auth = requireSystemAdmin(request, reply, database);

      if (!auth) {
        return { error: "Unauthorized" };
      }

      const { userId } = request.params as { userId: string };
      const existing = getAdminUser(database, userId);

      if (!existing) {
        reply.code(404);
        return { error: "User not found." };
      }

      database.connection
        .prepare(
          `
            UPDATE users
            SET disabled_at = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `
        )
        .run(userId);

      return { user: getAdminUser(database, userId)! };
    }
  );

  app.get(
    "/api/collections/:collectionId/members",
    async (request, reply): Promise<CollectionMembersResponse | { error: string }> => {
      const access = requireCollectionManager(request, reply, database);

      if (!access) {
        return { error: "Unauthorized" };
      }

      return {
        members: listCollectionMembers(database, access.collectionId),
        candidates: listCollectionMemberCandidates(database, access.collectionId)
      };
    }
  );

  app.post(
    "/api/collections/:collectionId/members",
    async (request, reply): Promise<{ member: CollectionMember } | { error: string }> => {
      const access = requireCollectionManager(request, reply, database);

      if (!access) {
        return { error: "Unauthorized" };
      }

      const body = request.body as AddCollectionMemberRequest;
      const role = validateCollectionRole(reply, body.role);
      const user = getAdminUser(database, body.userId ?? "");

      if (!user) {
        reply.code(404);
        return { error: "User not found." };
      }

      if (user.disabledAt) {
        reply.code(400);
        return { error: "Enable this user before adding them to a collection." };
      }

      if (collectionMemberExists(database, access.collectionId, user.id)) {
        reply.code(409);
        return { error: "This user is already a member of the collection." };
      }

      database.connection
        .prepare(
          `
            INSERT INTO collection_members (collection_id, user_id, role)
            VALUES (?, ?, ?)
          `
        )
        .run(access.collectionId, user.id, role);

      return { member: listCollectionMembers(database, access.collectionId).find((member) => member.userId === user.id)! };
    }
  );

  app.patch(
    "/api/collections/:collectionId/members/:userId",
    async (request, reply): Promise<{ member: CollectionMember } | { error: string }> => {
      const access = requireCollectionManager(request, reply, database);

      if (!access) {
        return { error: "Unauthorized" };
      }

      const { userId } = request.params as { collectionId: string; userId: string };
      const role = validateCollectionRole(reply, (request.body as UpdateCollectionMemberRequest).role);
      const member = getCollectionMember(database, access.collectionId, userId);

      if (!member) {
        reply.code(404);
        return { error: "Collection member not found." };
      }

      if (member.isOwner) {
        reply.code(400);
        return { error: "Collection owner role cannot be changed in v1." };
      }

      if (member.disabledAt) {
        reply.code(400);
        return { error: "Enable this user before changing their collection role." };
      }

      database.connection
        .prepare(
          `
            UPDATE collection_members
            SET role = ?
            WHERE collection_id = ? AND user_id = ?
          `
        )
        .run(role, access.collectionId, userId);

      return { member: getCollectionMember(database, access.collectionId, userId)! };
    }
  );

  app.delete(
    "/api/collections/:collectionId/members/:userId",
    async (request, reply): Promise<{ ok: true } | { error: string }> => {
      const access = requireCollectionManager(request, reply, database);

      if (!access) {
        return { error: "Unauthorized" };
      }

      const { userId } = request.params as { collectionId: string; userId: string };
      const member = getCollectionMember(database, access.collectionId, userId);

      if (!member) {
        reply.code(404);
        return { error: "Collection member not found." };
      }

      if (member.isOwner) {
        reply.code(400);
        return { error: "Collection owner membership cannot be removed in v1." };
      }

      database.connection
        .prepare("DELETE FROM collection_members WHERE collection_id = ? AND user_id = ?")
        .run(access.collectionId, userId);

      return { ok: true };
    }
  );

  app.get(
    "/api/collections/:collectionId/admin/status",
    async (request, reply): Promise<AdminCollectionStatusResponse | { error: string }> => {
      const access = requireCollectionManager(request, reply, database);

      if (!access) {
        return { error: "Unauthorized" };
      }

      return getCollectionAdminStatus(database, config, access.collectionId);
    }
  );
}

function requireSystemAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  database: AppDatabase
) {
  const auth = getAuthContext(request, database);

  if (!auth) {
    reply.code(401);
    return null;
  }

  if (auth.user.systemRole !== "admin") {
    reply.code(403);
    return null;
  }

  return auth;
}

function requireCollectionManager(
  request: FastifyRequest,
  reply: FastifyReply,
  database: AppDatabase
) {
  const auth = getAuthContext(request, database);

  if (!auth) {
    reply.code(401);
    return null;
  }

  const { collectionId } = request.params as { collectionId: string };

  if (!canManageCollection(database, collectionId, auth.user)) {
    reply.code(403);
    return null;
  }

  return { auth, collectionId };
}

function listAdminUsers(database: AppDatabase): AdminUser[] {
  const rows = database.connection
    .prepare(
      `
        SELECT
          u.id,
          u.email,
          u.username,
          u.display_name,
          u.system_role,
          u.disabled_at,
          u.created_at,
          u.updated_at,
          u.last_login_at,
          COUNT(DISTINCT cm.collection_id) AS collection_count,
          COUNT(DISTINCT s.id) AS active_session_count
        FROM users u
        LEFT JOIN collection_members cm ON cm.user_id = u.id
        LEFT JOIN sessions s ON s.user_id = u.id AND s.expires_at > ?
        GROUP BY u.id
        ORDER BY u.created_at ASC
      `
    )
    .all(new Date().toISOString()) as AdminUserRow[];

  return rows.map(mapAdminUser);
}

function getAdminUser(database: AppDatabase, userId: string): AdminUser | null {
  const row = database.connection
    .prepare(
      `
        SELECT
          u.id,
          u.email,
          u.username,
          u.display_name,
          u.system_role,
          u.disabled_at,
          u.created_at,
          u.updated_at,
          u.last_login_at,
          COUNT(DISTINCT cm.collection_id) AS collection_count,
          COUNT(DISTINCT s.id) AS active_session_count
        FROM users u
        LEFT JOIN collection_members cm ON cm.user_id = u.id
        LEFT JOIN sessions s ON s.user_id = u.id AND s.expires_at > ?
        WHERE u.id = ?
        GROUP BY u.id
      `
    )
    .get(new Date().toISOString(), userId) as AdminUserRow | undefined;

  return row ? mapAdminUser(row) : null;
}

function mapAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    systemRole: row.system_role,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    collectionCount: row.collection_count,
    activeSessionCount: row.active_session_count
  };
}

function validateUserInput({
  reply,
  email,
  username,
  displayName,
  systemRole
}: {
  reply: FastifyReply;
  email: string;
  username: string;
  displayName: string;
  systemRole: "admin" | "user";
}) {
  if (!validateEmail(email)) {
    reply.code(400);
    throw new Error("Enter a valid email address.");
  }

  if (!validateUsername(username)) {
    reply.code(400);
    throw new Error("Username must be 3-32 characters using letters, numbers, underscores, or hyphens.");
  }

  if (displayName.length < 2) {
    reply.code(400);
    throw new Error("Enter a display name.");
  }

  if (!["admin", "user"].includes(systemRole)) {
    reply.code(400);
    throw new Error("System role must be admin or user.");
  }
}

function validatePassword(reply: FastifyReply, password: string) {
  if (password.length < 8) {
    reply.code(400);
    throw new Error("Password must be at least 8 characters.");
  }
}

function ensureUserIdentityAvailable(
  database: AppDatabase,
  reply: FastifyReply,
  input: { email: string; username: string; excludeUserId?: string }
) {
  const row = database.connection
    .prepare(
      `
        SELECT id, email, username
        FROM users
        WHERE (email = ? OR username = ?)
          AND (? IS NULL OR id != ?)
        LIMIT 1
      `
    )
    .get(input.email, input.username, input.excludeUserId ?? null, input.excludeUserId ?? null) as
    | { id: string; email: string; username: string }
    | undefined;

  if (!row) {
    return;
  }

  reply.code(409);

  if (row.email === input.email) {
    throw new Error("A user with that email already exists.");
  }

  throw new Error("A user with that username already exists.");
}

function enabledSystemAdminCount(database: AppDatabase) {
  const row = database.connection
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM users
        WHERE system_role = 'admin' AND disabled_at IS NULL
      `
    )
    .get() as { count: number };

  return row.count;
}

function validateCollectionRole(reply: FastifyReply, role: string | undefined): CollectionRole {
  if (!collectionRoles.includes(role as CollectionRole)) {
    reply.code(400);
    throw new Error("Collection role must be admin, editor, or viewer.");
  }

  return role as CollectionRole;
}

function listCollectionMembers(database: AppDatabase, collectionId: string): CollectionMember[] {
  const rows = database.connection
    .prepare(
      `
        SELECT
          cm.user_id,
          u.email,
          u.username,
          u.display_name,
          u.system_role,
          u.disabled_at,
          cm.role,
          cm.created_at,
          c.owner_user_id
        FROM collection_members cm
        INNER JOIN users u ON u.id = cm.user_id
        INNER JOIN collections c ON c.id = cm.collection_id
        WHERE cm.collection_id = ?
        ORDER BY
          CASE cm.role
            WHEN 'owner' THEN 0
            WHEN 'admin' THEN 1
            WHEN 'editor' THEN 2
            ELSE 3
          END,
          u.display_name ASC
      `
    )
    .all(collectionId) as CollectionMemberRow[];

  return rows.map(mapCollectionMember);
}

function getCollectionMember(
  database: AppDatabase,
  collectionId: string,
  userId: string
): CollectionMember | null {
  return (
    listCollectionMembers(database, collectionId).find((member) => member.userId === userId) ??
    null
  );
}

function mapCollectionMember(row: CollectionMemberRow): CollectionMember {
  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    systemRole: row.system_role,
    disabledAt: row.disabled_at,
    role: row.role,
    createdAt: row.created_at,
    isOwner: row.user_id === row.owner_user_id
  };
}

function collectionMemberExists(
  database: AppDatabase,
  collectionId: string,
  userId: string
) {
  const row = database.connection
    .prepare("SELECT user_id FROM collection_members WHERE collection_id = ? AND user_id = ?")
    .get(collectionId, userId) as { user_id: string } | undefined;

  return Boolean(row);
}

function listCollectionMemberCandidates(
  database: AppDatabase,
  collectionId: string
): CollectionMemberCandidate[] {
  const rows = database.connection
    .prepare(
      `
        SELECT
          u.id,
          u.email,
          u.username,
          u.display_name,
          u.system_role,
          u.disabled_at
        FROM users u
        WHERE NOT EXISTS (
          SELECT 1
          FROM collection_members cm
          WHERE cm.collection_id = ? AND cm.user_id = u.id
        )
        ORDER BY u.display_name ASC
      `
    )
    .all(collectionId) as Array<{
    id: string;
    email: string;
    username: string;
    display_name: string;
    system_role: "admin" | "user";
    disabled_at: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    systemRole: row.system_role,
    disabledAt: row.disabled_at
  }));
}

function getCollectionAdminStatus(
  database: AppDatabase,
  config: AppConfig,
  collectionId: string
): AdminCollectionStatusResponse {
  const state = database.connection
    .prepare(
      `
        SELECT run_started_at, run_completed_at, cursor_item_id, updated_at
        FROM collection_price_refresh_state
        WHERE collection_id = ?
      `
    )
    .get(collectionId) as
    | {
        run_started_at: string | null;
        run_completed_at: string | null;
        cursor_item_id: string | null;
        updated_at: string;
      }
    | undefined;
  const queueSummary = getQueueSummary(database, collectionId);
  const ignoredItems = listIgnoredPriceRefreshItems(database, collectionId);

  return {
    backups: {
      scheduledEnabled: config.scheduledBackupsEnabled,
      intervalHours: config.backupIntervalHours,
      retentionDays: config.backupRetentionDays,
      latest: listSqliteBackups(database, 5)
    },
    pricing: {
      scheduledEnabled: config.scheduledPriceRefreshEnabled,
      intervalHours: config.priceRefreshIntervalHours,
      batchSize: config.priceRefreshBatchSize,
      runStartedAt: state?.run_started_at ?? null,
      runCompletedAt: state?.run_completed_at ?? null,
      cursorItemId: state?.cursor_item_id ?? null,
      updatedAt: state?.updated_at ?? null,
      nextDueAt: nextPriceRefreshDueAt(state?.run_completed_at ?? null, config.priceRefreshIntervalHours),
      ignoredCount: ignoredItems.length,
      ignoredItems,
      queueSummary
    }
  };
}

function getQueueSummary(
  database: AppDatabase,
  collectionId: string
): BulkPriceQueueResponse["summary"] {
  const summary: BulkPriceQueueResponse["summary"] = {
    total: 0,
    queued: 0,
    running: 0,
    saved: 0,
    needsReview: 0,
    skipped: 0,
    rateLimited: 0,
    failed: 0,
    cancelled: 0
  };
  const rows = database.connection
    .prepare(
      `
        SELECT status, COUNT(*) AS count
        FROM bulk_price_queue
        WHERE collection_id = ?
        GROUP BY status
      `
    )
    .all(collectionId) as { status: string; count: number }[];

  for (const row of rows) {
    summary.total += row.count;

    if (row.status === "needs-review") {
      summary.needsReview = row.count;
    } else if (row.status === "rate-limited") {
      summary.rateLimited = row.count;
    } else if (row.status in summary) {
      summary[row.status as keyof typeof summary] = row.count;
    }
  }

  return summary;
}

function listIgnoredPriceRefreshItems(
  database: AppDatabase,
  collectionId: string
): AdminIgnoredPriceRefreshItem[] {
  const rows = database.connection
    .prepare(
      `
        SELECT
          oi.id AS item_id,
          c.name,
          c.set_name,
          c.card_number,
          ipri.reason,
          ipri.ignored_at
        FROM item_price_refresh_ignores ipri
        INNER JOIN owned_items oi ON oi.id = ipri.owned_item_id
        INNER JOIN cards c ON c.id = oi.card_id
        WHERE oi.collection_id = ?
        ORDER BY ipri.ignored_at DESC
        LIMIT 20
      `
    )
    .all(collectionId) as Array<{
    item_id: string;
    name: string;
    set_name: string | null;
    card_number: string | null;
    reason: string | null;
    ignored_at: string;
  }>;

  return rows.map((row) => ({
    itemId: row.item_id,
    name: row.name,
    setName: row.set_name,
    cardNumber: row.card_number,
    reason: row.reason,
    ignoredAt: row.ignored_at
  }));
}

function nextPriceRefreshDueAt(completedAt: string | null, intervalHours: number) {
  if (!completedAt) {
    return null;
  }

  const timestamp = Date.parse(completedAt);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp + intervalHours * 60 * 60 * 1000).toISOString();
}
