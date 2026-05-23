/**
 * SQLite schema setup for conversations, messages, and contacts.
 *
 * Keep this file focused on table/index creation. Data access belongs in the
 * repository files, and dummy starter data belongs in `seed.ts`.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

async function ensureColumn(
  db: SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
) {
  const rows = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table});`,
  );

  const names = new Set(rows.map((r) => r.name));

  if (!names.has(column)) {
    await db.execAsync(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`,
    );
  }
}

async function getTableColumns(db: SQLiteDatabase, table: string) {
  const rows = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table});`,
  );

  return new Set(rows.map((row) => row.name));
}

/**
 * Rebuilds the old phone-number contacts table into the new email-based table.
 */
async function migrateContactsToEmailSchema(db: SQLiteDatabase) {
  const contactColumns = await getTableColumns(db, 'contacts');

  const hasOldPhoneSchema =
    contactColumns.has('phone_number') ||
    contactColumns.has('phone_number_normalized');

  const hasEmailSchema =
    contactColumns.has('email') && contactColumns.has('normalized_email');

  if (hasOldPhoneSchema && !hasEmailSchema) {
    await db.execAsync(`
      DROP TABLE IF EXISTS contacts;
    `);
  }

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clerk_user_id TEXT NOT NULL,
      remote_id TEXT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      normalized_email TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      sync_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(clerk_user_id, normalized_email)
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_clerk_user_id
    ON contacts (clerk_user_id);

    CREATE INDEX IF NOT EXISTS idx_contacts_name
    ON contacts (name);

    CREATE INDEX IF NOT EXISTS idx_contacts_normalized_email
    ON contacts (normalized_email);

    CREATE INDEX IF NOT EXISTS idx_contacts_updated_at
    ON contacts (updated_at);
  `);
}

/**
 * Adds columns introduced after the first app release.
 */
async function migrateLegacySchema(db: SQLiteDatabase) {
  await ensureColumn(db, 'conversations', 'last_message', 'TEXT');

  // Conversation sync fields
  await ensureColumn(db, 'conversations', 'remote_id', 'TEXT');
  await ensureColumn(
    db,
    'conversations',
    'synced',
    'INTEGER NOT NULL DEFAULT 0',
  );
  await ensureColumn(db, 'conversations', 'sync_error', 'TEXT');

  // Conversation owner/contact-link fields
  await ensureColumn(db, 'conversations', 'owner_clerk_user_id', 'TEXT');
  await ensureColumn(db, 'conversations', 'contact_name', 'TEXT');
  await ensureColumn(db, 'conversations', 'contact_email', 'TEXT');
  await ensureColumn(
    db,
    'conversations',
    'contact_normalized_email',
    'TEXT',
  );
  await ensureColumn(db, 'conversations', 'contact_clerk_user_id', 'TEXT');

  // Shared conversation key for both participants
  await ensureColumn(db, 'conversations', 'participant_key', 'TEXT');

  // Message sync fields
  await ensureColumn(db, 'messages', 'summary', 'TEXT');
  await ensureColumn(db, 'messages', 'remote_id', 'TEXT');
  await ensureColumn(db, 'messages', 'sync_error', 'TEXT');
  await ensureColumn(
    db,
    'messages',
    'synced',
    'INTEGER NOT NULL DEFAULT 0',
  );

  // Contact sync fields
  await ensureColumn(db, 'contacts', 'clerk_user_id', 'TEXT');
  await ensureColumn(db, 'contacts', 'remote_id', 'TEXT');
  await ensureColumn(db, 'contacts', 'sync_error', 'TEXT');
  await ensureColumn(
    db,
    'contacts',
    'synced',
    'INTEGER NOT NULL DEFAULT 0',
  );
}

/**
 * Creates indexes that depend on columns added by legacy migrations.
 */
async function createPostMigrationIndexes(db: SQLiteDatabase) {
  await db.execAsync(`
    DROP INDEX IF EXISTS idx_conversations_contact_email;
    DROP INDEX IF EXISTS idx_messages_remote_id;

    DELETE FROM messages
    WHERE remote_id IS NOT NULL
      AND id NOT IN (
        SELECT MIN(id)
        FROM messages
        WHERE remote_id IS NOT NULL
        GROUP BY remote_id
      );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_owner_contact_email
    ON conversations (owner_clerk_user_id, contact_normalized_email)
    WHERE owner_clerk_user_id IS NOT NULL
      AND contact_normalized_email IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_participant_key
    ON conversations (participant_key)
    WHERE participant_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_conversations_owner
    ON conversations (owner_clerk_user_id);

    CREATE INDEX IF NOT EXISTS idx_conversations_contact_user
    ON conversations (contact_clerk_user_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_remote_id
    ON messages (remote_id);
  `);
}

/**
 * Creates the local app tables if they do not already exist.
 */
export async function runMigrations(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      last_message TEXT,

      remote_id TEXT,
      sync_error TEXT,
      synced INTEGER NOT NULL DEFAULT 0,

      owner_clerk_user_id TEXT,
      contact_name TEXT,
      contact_email TEXT,
      contact_normalized_email TEXT,
      contact_clerk_user_id TEXT,
      participant_key TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'assistant', 'system')),
      body TEXT NOT NULL,
      summary TEXT,
      remote_id TEXT,
      sync_error TEXT,
      synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS seed_history (
      seed_key TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
    ON conversations (updated_at);

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
    ON messages (conversation_id);

    CREATE INDEX IF NOT EXISTS idx_messages_created_at
    ON messages (created_at);
  `);

  await migrateContactsToEmailSchema(db);
  await migrateLegacySchema(db);
  await createPostMigrationIndexes(db);
}