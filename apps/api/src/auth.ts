import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthUser, CollectionSummary } from "@collection-tool/shared";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";

const sessionCookieName = "collection_session";
const passwordKeyLength = 64;
const sessionDays = 30;

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  system_role: "admin" | "user";
};

type SessionUserRow = UserRow & {
  expires_at: string;
};

type CollectionRow = {
  id: string;
  name: string;
  role: "owner" | "admin" | "editor" | "viewer";
};

export type AuthContext = {
  user: AuthUser;
  sessionId: string;
};

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, passwordKeyLength).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, salt: string, expectedHash: string) {
  const candidate = scryptSync(password, salt, passwordKeyLength);
  const expected = Buffer.from(expectedHash, "hex");

  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}

export function hashToken(token: string) {
  return scryptSync(token, "collection-session-token", 32).toString("hex");
}

export function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    systemRole: row.system_role
  };
}

export function countUsers(database: AppDatabase) {
  const row = database.connection.prepare("SELECT COUNT(*) AS count FROM users").get() as {
    count: number;
  };

  return row.count;
}

export function listCollectionsForUser(
  database: AppDatabase,
  userId: string
): CollectionSummary[] {
  const rows = database.connection
    .prepare(
      `
        SELECT c.id, c.name, cm.role
        FROM collections c
        INNER JOIN collection_members cm ON cm.collection_id = c.id
        WHERE cm.user_id = ?
        ORDER BY c.created_at ASC
      `
    )
    .all(userId) as CollectionRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    cardCount: 0,
    estimatedValueCents: 0
  }));
}

export function createBootstrapUser(
  database: AppDatabase,
  input: { email: string; displayName: string; password: string }
) {
  if (countUsers(database) > 0) {
    throw new Error("Bootstrap has already been completed.");
  }

  const userId = randomUUID();
  const collectionId = randomUUID();
  const normalizedEmail = normalizeEmail(input.email);
  const { hash, salt } = hashPassword(input.password);

  database.connection.exec("BEGIN");
  try {
    database.connection
      .prepare(
        `
          INSERT INTO users (id, email, display_name, password_hash, password_salt, system_role)
          VALUES (?, ?, ?, ?, ?, 'admin')
        `
      )
      .run(userId, normalizedEmail, input.displayName.trim(), hash, salt);

    database.connection
      .prepare(
        `
          INSERT INTO collections (id, name, owner_user_id)
          VALUES (?, 'Main Collection', ?)
        `
      )
      .run(collectionId, userId);

    database.connection
      .prepare(
        `
          INSERT INTO collection_members (collection_id, user_id, role)
          VALUES (?, ?, 'owner')
        `
      )
      .run(collectionId, userId);

    database.connection.exec("COMMIT");
  } catch (error) {
    database.connection.exec("ROLLBACK");
    throw error;
  }

  return getUserById(database, userId);
}

export function createSession(database: AppDatabase, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString();

  database.connection
    .prepare(
      `
        INSERT INTO sessions (id, user_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
      `
    )
    .run(sessionId, userId, hashToken(token), expiresAt);

  return { token, expiresAt };
}

export function setSessionCookie(reply: FastifyReply, config: AppConfig, token: string) {
  reply.setCookie(sessionCookieName, token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: config.cookieSecure,
    maxAge: sessionDays * 24 * 60 * 60
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig) {
  reply.clearCookie(sessionCookieName, {
    path: "/",
    secure: config.cookieSecure,
    sameSite: "lax"
  });
}

export function getUserById(database: AppDatabase, userId: string) {
  const row = database.connection
    .prepare(
      `
        SELECT id, email, display_name, password_hash, password_salt, system_role
        FROM users
        WHERE id = ?
      `
    )
    .get(userId) as UserRow | undefined;

  return row ? mapUser(row) : null;
}

export function authenticateLogin(
  database: AppDatabase,
  input: { email: string; password: string }
) {
  const row = database.connection
    .prepare(
      `
        SELECT id, email, display_name, password_hash, password_salt, system_role
        FROM users
        WHERE email = ?
      `
    )
    .get(normalizeEmail(input.email)) as UserRow | undefined;

  if (!row || !verifyPassword(input.password, row.password_salt, row.password_hash)) {
    return null;
  }

  database.connection
    .prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(row.id);

  return mapUser(row);
}

export function getAuthContext(request: FastifyRequest, database: AppDatabase): AuthContext | null {
  const token = request.cookies[sessionCookieName];

  if (!token) {
    return null;
  }

  const row = database.connection
    .prepare(
      `
        SELECT u.id, u.email, u.display_name, u.password_hash, u.password_salt, u.system_role, s.expires_at
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
      `
    )
    .get(hashToken(token)) as SessionUserRow | undefined;

  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    return null;
  }

  const session = database.connection
    .prepare("SELECT id FROM sessions WHERE token_hash = ?")
    .get(hashToken(token)) as { id: string } | undefined;

  return session
    ? {
        user: mapUser(row),
        sessionId: session.id
      }
    : null;
}

export function deleteSession(database: AppDatabase, sessionId: string) {
  database.connection.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function pruneExpiredSessions(database: AppDatabase) {
  database.connection
    .prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .run(new Date().toISOString());
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

