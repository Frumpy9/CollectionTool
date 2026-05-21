import { randomUUID } from "node:crypto";
import { hashPassword, normalizeEmail, normalizeUsername } from "../auth.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db.js";

const config = loadConfig();
const database = openDatabase(config.databasePath);

const username = normalizeUsername("admin");
const email = normalizeEmail("admin@example.test");
const displayName = "Dev Admin";
const password = "admin";
const { hash, salt } = hashPassword(password);

const existing = database.connection
  .prepare("SELECT id FROM users WHERE username = ? OR email = ?")
  .get(username, email) as { id: string } | undefined;

const userId = existing?.id ?? randomUUID();

database.connection.exec("BEGIN");
try {
  if (existing) {
    database.connection
      .prepare(
        `
          UPDATE users
          SET
            email = ?,
            username = ?,
            display_name = ?,
            password_hash = ?,
            password_salt = ?,
            system_role = 'admin',
            disabled_at = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `
      )
      .run(email, username, displayName, hash, salt, userId);
  } else {
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
          VALUES (?, ?, ?, ?, ?, ?, 'admin')
        `
      )
      .run(userId, email, username, displayName, hash, salt);
  }

  const collection = database.connection
    .prepare(
      `
        SELECT c.id
        FROM collections c
        INNER JOIN collection_members cm ON cm.collection_id = c.id
        WHERE cm.user_id = ?
        ORDER BY c.created_at ASC
        LIMIT 1
      `
    )
    .get(userId) as { id: string } | undefined;

  if (!collection) {
    const collectionId = randomUUID();

    database.connection
      .prepare(
        `
          INSERT INTO collections (id, name, owner_user_id)
          VALUES (?, 'Dev Collection', ?)
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
  }

  database.connection.exec("COMMIT");
} catch (error) {
  database.connection.exec("ROLLBACK");
  throw error;
} finally {
  database.connection.close();
}

console.log("Seeded dev account: username admin, password admin");
