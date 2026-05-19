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
        release_year TEXT,
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
  },
  {
    id: 7,
    name: "graded_cert_metadata",
    sql: `
      ALTER TABLE owned_items ADD COLUMN cert_url TEXT;
      ALTER TABLE owned_items ADD COLUMN cert_spec_id TEXT;
      ALTER TABLE owned_items ADD COLUMN cert_category TEXT;
      ALTER TABLE owned_items ADD COLUMN cert_population TEXT;
      ALTER TABLE owned_items ADD COLUMN cert_population_higher TEXT;
      ALTER TABLE owned_items ADD COLUMN cert_estimate_cents INTEGER CHECK (cert_estimate_cents IS NULL OR cert_estimate_cents >= 0);
      ALTER TABLE owned_items ADD COLUMN cert_lookup_at TEXT;

      CREATE INDEX IF NOT EXISTS idx_owned_items_cert_number
      ON owned_items(grader, cert_number);

      UPDATE app_metadata
      SET value = '7', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  },
  {
    id: 8,
    name: "raw_market_prices",
    sql: `
      CREATE TABLE IF NOT EXISTS item_market_prices (
        owned_item_id TEXT PRIMARY KEY REFERENCES owned_items(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('justtcg')),
        source_card_id TEXT NOT NULL,
        source_variant_id TEXT NOT NULL,
        matched_name TEXT NOT NULL,
        matched_set_name TEXT,
        matched_card_number TEXT,
        condition_label TEXT,
        printing TEXT,
        language TEXT,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        confidence TEXT NOT NULL CHECK (confidence IN ('exact', 'strong', 'possible')),
        looked_up_at TEXT NOT NULL,
        raw_payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_item_market_prices_source_card
      ON item_market_prices(source, source_card_id);

      UPDATE app_metadata
      SET value = '8', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  },
  {
    id: 9,
    name: "graded_market_price_source",
    sql: `
      CREATE TABLE IF NOT EXISTS item_market_prices_next (
        owned_item_id TEXT PRIMARY KEY REFERENCES owned_items(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('justtcg', 'pokemonpricetracker')),
        source_card_id TEXT NOT NULL,
        source_variant_id TEXT NOT NULL,
        matched_name TEXT NOT NULL,
        matched_set_name TEXT,
        matched_card_number TEXT,
        condition_label TEXT,
        printing TEXT,
        language TEXT,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        confidence TEXT NOT NULL CHECK (confidence IN ('exact', 'strong', 'possible')),
        looked_up_at TEXT NOT NULL,
        raw_payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT OR IGNORE INTO item_market_prices_next (
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
        created_at,
        updated_at
      )
      SELECT
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
        created_at,
        updated_at
      FROM item_market_prices;

      DROP TABLE item_market_prices;
      ALTER TABLE item_market_prices_next RENAME TO item_market_prices;

      CREATE INDEX IF NOT EXISTS idx_item_market_prices_source_card
      ON item_market_prices(source, source_card_id);

      UPDATE app_metadata
      SET value = '9', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  },
  {
    id: 10,
    name: "bulk_price_queue",
    sql: `
      CREATE TABLE IF NOT EXISTS bulk_price_queue (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        owned_item_id TEXT NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK (mode IN ('auto', 'raw', 'graded')) DEFAULT 'auto',
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'saved', 'needs-review', 'skipped', 'rate-limited', 'failed', 'cancelled')) DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        include_existing INTEGER NOT NULL DEFAULT 0 CHECK (include_existing IN (0, 1)),
        message TEXT,
        next_attempt_at TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_bulk_price_queue_collection_status
      ON bulk_price_queue(collection_id, status, next_attempt_at);

      CREATE INDEX IF NOT EXISTS idx_bulk_price_queue_item
      ON bulk_price_queue(collection_id, owned_item_id);

      UPDATE app_metadata
      SET value = '10', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  },
  {
    id: 11,
    name: "pricing_source_matches",
    sql: `
      CREATE TABLE IF NOT EXISTS item_price_source_matches (
        owned_item_id TEXT NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('justtcg', 'pokemonpricetracker')),
        source_card_id TEXT NOT NULL,
        source_variant_id TEXT NOT NULL,
        match_kind TEXT NOT NULL CHECK (match_kind IN ('automatic', 'manual')),
        confidence TEXT NOT NULL CHECK (confidence IN ('exact', 'strong', 'possible')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (owned_item_id, source)
      );

      CREATE INDEX IF NOT EXISTS idx_item_price_source_matches_source_card
      ON item_price_source_matches(source, source_card_id);

      UPDATE app_metadata
      SET value = '11', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  },
  {
    id: 12,
    name: "pricing_history_cache",
    sql: `
      CREATE TABLE IF NOT EXISTS item_price_history (
        owned_item_id TEXT NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('justtcg', 'pokemonpricetracker')),
        price_kind TEXT NOT NULL CHECK (price_kind IN ('raw', 'graded')),
        history_date TEXT NOT NULL,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (owned_item_id, source, price_kind, history_date)
      );

      CREATE INDEX IF NOT EXISTS idx_item_price_history_item_date
      ON item_price_history(owned_item_id, history_date);

      UPDATE app_metadata
      SET value = '12', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  },
  {
    id: 13,
    name: "card_release_year",
    sql: `
      ALTER TABLE cards ADD COLUMN release_year TEXT;

      UPDATE app_metadata
      SET value = '13', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  },
  {
    id: 14,
    name: "value_override_history",
    sql: `
      CREATE TABLE IF NOT EXISTS item_value_override_history (
        id TEXT PRIMARY KEY,
        owned_item_id TEXT NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
        previous_value_cents INTEGER CHECK (previous_value_cents IS NULL OR previous_value_cents >= 0),
        next_value_cents INTEGER CHECK (next_value_cents IS NULL OR next_value_cents >= 0),
        changed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_item_value_override_history_item_changed
      ON item_value_override_history(owned_item_id, changed_at DESC);

      UPDATE app_metadata
      SET value = '14', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  },
  {
    id: 15,
    name: "scheduled_price_refresh_state",
    sql: `
      CREATE TABLE IF NOT EXISTS collection_price_refresh_state (
        collection_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
        run_started_at TEXT,
        run_completed_at TEXT,
        cursor_item_id TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      UPDATE app_metadata
      SET value = '15', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  },
  {
    id: 16,
    name: "item_price_refresh_ignores",
    sql: `
      CREATE TABLE IF NOT EXISTS item_price_refresh_ignores (
        owned_item_id TEXT PRIMARY KEY REFERENCES owned_items(id) ON DELETE CASCADE,
        reason TEXT,
        ignored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      UPDATE app_metadata
      SET value = '16', updated_at = CURRENT_TIMESTAMP
      WHERE key = 'schema_version';
    `
  },
  {
    id: 17,
    name: "local_market_price_snapshots",
    sql: `
      CREATE TABLE IF NOT EXISTS item_market_price_snapshots (
        id TEXT PRIMARY KEY,
        owned_item_id TEXT NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('justtcg', 'pokemonpricetracker')),
        price_kind TEXT NOT NULL CHECK (price_kind IN ('raw', 'graded')),
        source_card_id TEXT NOT NULL,
        source_variant_id TEXT NOT NULL,
        matched_name TEXT NOT NULL,
        matched_set_name TEXT,
        matched_card_number TEXT,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        previous_price_cents INTEGER CHECK (previous_price_cents IS NULL OR previous_price_cents >= 0),
        delta_cents INTEGER,
        confidence TEXT NOT NULL CHECK (confidence IN ('exact', 'strong', 'possible')),
        captured_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_item_market_price_snapshots_item_captured
      ON item_market_price_snapshots(owned_item_id, captured_at DESC);

      UPDATE app_metadata
      SET value = '17', updated_at = CURRENT_TIMESTAMP
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

  ensureOwnedItemCertMetadataColumns(connection);
  ensureCardReleaseYearColumn(connection);

  return {
    path: databasePath,
    connection,
    migrationsApplied
  };
}

function ensureCardReleaseYearColumn(connection: DatabaseSync) {
  const columns = new Set(
    connection
      .prepare("PRAGMA table_info(cards)")
      .all()
      .map((column) => String((column as { name: string }).name))
  );

  if (columns.has("release_year")) {
    return;
  }

  connection.exec("BEGIN");
  try {
    connection.exec("ALTER TABLE cards ADD COLUMN release_year TEXT;");
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

function ensureOwnedItemCertMetadataColumns(connection: DatabaseSync) {
  const columns = new Set(
    connection
      .prepare("PRAGMA table_info(owned_items)")
      .all()
      .map((column) => String((column as { name: string }).name))
  );

  const missingColumns = [
    ["cert_url", "TEXT"],
    ["cert_spec_id", "TEXT"],
    ["cert_category", "TEXT"],
    ["cert_population", "TEXT"],
    ["cert_population_higher", "TEXT"],
    [
      "cert_estimate_cents",
      "INTEGER CHECK (cert_estimate_cents IS NULL OR cert_estimate_cents >= 0)"
    ],
    ["cert_lookup_at", "TEXT"]
  ].filter(([name]) => !columns.has(name));

  if (missingColumns.length === 0) {
    return;
  }

  connection.exec("BEGIN");
  try {
    for (const [name, definition] of missingColumns) {
      connection.exec(`ALTER TABLE owned_items ADD COLUMN ${name} ${definition};`);
    }

    connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_owned_items_cert_number
      ON owned_items(grader, cert_number);
    `);

    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}
