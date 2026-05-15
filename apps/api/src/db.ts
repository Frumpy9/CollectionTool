import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

type Migration = {
  id: number;
  name: string;
  sql: string;
};

const migrations: Migration[] = [
  {
    id: 1,
    name: "initial_app_metadata",
    sql: `
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT OR IGNORE INTO app_metadata (key, value)
      VALUES ('schema_version', '1');
    `
  },
  {
    id: 2,
    name: "auth_and_collections",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        system_role TEXT NOT NULL CHECK (system_role IN ('admin', 'user')) DEFAULT 'user',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        default_locale TEXT NOT NULL CHECK (default_locale IN ('en', 'ja')) DEFAULT 'en',
        currency TEXT NOT NULL DEFAULT 'USD',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS collection_members (
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (collection_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS collection_invites (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        accepted_at TEXT,
        created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      UPDATE app_metadata
      SET value = '2', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  },
  {
    id: 3,
    name: "add_usernames",
    sql: `
      ALTER TABLE users ADD COLUMN username TEXT;

      UPDATE users
      SET username = lower(substr(email, 1, instr(email, '@') - 1))
      WHERE username IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

      UPDATE app_metadata
      SET value = '3', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  }
];

export type AppDatabase = {
  path: string;
  connection: DatabaseSync;
  migrationsApplied: number;
};

export function openDatabase(databasePath: string): AppDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });

  const connection = new DatabaseSync(databasePath);
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  let migrationsApplied = 0;

  for (const migration of migrations) {
    const existing = connection
      .prepare("SELECT id FROM schema_migrations WHERE id = ?")
      .get(migration.id);

    if (existing) {
      continue;
    }

    connection.exec("BEGIN");
    try {
      connection.exec(migration.sql);
      connection
        .prepare("INSERT INTO schema_migrations (id, name) VALUES (?, ?)")
        .run(migration.id, migration.name);
      connection.exec("COMMIT");
      migrationsApplied += 1;
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    path: databasePath,
    connection,
    migrationsApplied
  };
}
