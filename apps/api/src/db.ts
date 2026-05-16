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
  },
  {
    id: 4,
    name: "manual_inventory",
    sql: `
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        set_name TEXT,
        set_code TEXT,
        card_number TEXT,
        language TEXT NOT NULL CHECK (language IN ('en', 'ja', 'other')) DEFAULT 'en',
        rarity TEXT,
        image_url TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        source_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_cards_manual_lookup
      ON cards(name, set_code, card_number, language);

      CREATE TABLE IF NOT EXISTS owned_items (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL CHECK (item_type IN ('raw', 'graded')) DEFAULT 'raw',
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
        condition_label TEXT,
        condition_score REAL CHECK (condition_score IS NULL OR (condition_score >= 1 AND condition_score <= 10)),
        variant_details TEXT,
        grader TEXT,
        grade TEXT,
        cert_number TEXT,
        purchase_price_cents INTEGER CHECK (purchase_price_cents IS NULL OR purchase_price_cents >= 0),
        purchase_date TEXT,
        value_override_cents INTEGER CHECK (value_override_cents IS NULL OR value_override_cents >= 0),
        storage_location TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_owned_items_collection_id
      ON owned_items(collection_id);

      CREATE INDEX IF NOT EXISTS idx_owned_items_card_id
      ON owned_items(card_id);

      UPDATE app_metadata
      SET value = '4', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  },
  {
    id: 5,
    name: "japanese_card_cache",
    sql: `
      CREATE TABLE IF NOT EXISTS japanese_card_cache (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        set_code TEXT NOT NULL,
        set_name TEXT,
        card_number TEXT NOT NULL,
        printed_number TEXT NOT NULL,
        printed_total TEXT,
        name TEXT NOT NULL,
        rarity TEXT,
        image_url TEXT,
        raw_payload TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source, source_id)
      );

      CREATE INDEX IF NOT EXISTS idx_japanese_card_cache_set_number
      ON japanese_card_cache(set_code, printed_number);

      CREATE INDEX IF NOT EXISTS idx_japanese_card_cache_number_total
      ON japanese_card_cache(printed_number, printed_total);

      CREATE INDEX IF NOT EXISTS idx_japanese_card_cache_name
      ON japanese_card_cache(name);

      UPDATE app_metadata
      SET value = '5', updated_at = CURRENT_TIMESTAMP
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
