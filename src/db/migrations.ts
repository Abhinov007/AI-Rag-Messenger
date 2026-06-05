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

  const names = new Set(rows.map((row) => row.name));

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
  await ensureColumn(db, 'conversations', 'created_at_unix', 'INTEGER');
  await ensureColumn(db, 'conversations', 'updated_at_unix', 'INTEGER');

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

  // User-specific chat hiding fields
  await ensureColumn(
    db,
    'conversations',
    'hidden_for_user',
    'INTEGER NOT NULL DEFAULT 0',
  );
  await ensureColumn(db, 'conversations', 'hidden_at', 'TEXT');

  // Message sync fields
  await ensureColumn(db, 'messages', 'summary', 'TEXT');
  await ensureColumn(db, 'messages', 'remote_id', 'TEXT');
  await ensureColumn(db, 'messages', 'sync_error', 'TEXT');
  await ensureColumn(db, 'messages', 'created_at_unix', 'INTEGER');
  await ensureColumn(
    db,
    'messages',
    'synced',
    'INTEGER NOT NULL DEFAULT 0',
  );

  // Message ownership field: needed for left/right chat alignment
  await ensureColumn(db, 'messages', 'sender_clerk_user_id', 'TEXT');

  // User-specific message deletion fields
  // Used when the current user deletes one message from their own chat view.
  await ensureColumn(
    db,
    'messages',
    'deleted_for_user',
    'INTEGER NOT NULL DEFAULT 0',
  );
  await ensureColumn(db, 'messages', 'deleted_at', 'TEXT');

  await ensureColumn(
    db,
    'messages_archive',
    'deleted_for_user',
    'INTEGER NOT NULL DEFAULT 0',
  );
  await ensureColumn(db, 'messages_archive', 'deleted_at', 'TEXT');

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

async function backfillSortableTimestamps(db: SQLiteDatabase) {
  await db.execAsync(`
    UPDATE conversations
    SET
      created_at_unix = COALESCE(created_at_unix, unixepoch(created_at)),
      updated_at_unix = COALESCE(updated_at_unix, unixepoch(updated_at));

    UPDATE messages
    SET created_at_unix = COALESCE(created_at_unix, unixepoch(created_at));

    UPDATE messages_archive
    SET created_at_unix = COALESCE(created_at_unix, unixepoch(created_at));
  `);
}

async function normalizeStoredTimestampText(db: SQLiteDatabase) {
  await db.execAsync(`
    UPDATE conversations
    SET
      created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
    WHERE created_at IS NOT NULL
      AND updated_at IS NOT NULL;

    UPDATE messages
    SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
    WHERE created_at IS NOT NULL;

    UPDATE messages_archive
    SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
    WHERE created_at IS NOT NULL;

    UPDATE contacts
    SET
      created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
    WHERE created_at IS NOT NULL
      AND updated_at IS NOT NULL;
  `);
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

    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at_unix
    ON conversations (updated_at_unix DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_conversations_owner_updated_at_unix
    ON conversations (owner_clerk_user_id, updated_at_unix DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_conversations_owner_visible_updated_at_unix
    ON conversations (
      owner_clerk_user_id,
      hidden_for_user,
      updated_at_unix DESC,
      id DESC
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_contact_user_updated_at_unix
    ON conversations (contact_clerk_user_id, updated_at_unix DESC, id DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_remote_id
    ON messages (remote_id)
    WHERE remote_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_messages_sender_clerk_user_id
    ON messages (sender_clerk_user_id);

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at_unix
    ON messages (conversation_id, created_at_unix ASC, id ASC);

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at_unix_desc
    ON messages (conversation_id, created_at_unix DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_visible_created_at_unix
    ON messages (
      conversation_id,
      deleted_for_user,
      created_at_unix ASC,
      id ASC
    );

    CREATE INDEX IF NOT EXISTS idx_messages_synced_created_at_unix
    ON messages (synced, created_at_unix ASC, id ASC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_archive_remote_id
    ON messages_archive (remote_id)
    WHERE remote_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_messages_archive_conversation_created_at_unix
    ON messages_archive (conversation_id, created_at_unix ASC, id ASC);

    CREATE INDEX IF NOT EXISTS idx_messages_archive_conversation_created_at_unix_desc
    ON messages_archive (conversation_id, created_at_unix DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_messages_archive_conversation_visible_created_at_unix
    ON messages_archive (
      conversation_id,
      deleted_for_user,
      created_at_unix ASC,
      id ASC
    );

    CREATE TRIGGER IF NOT EXISTS trg_conversations_insert_sort_keys
    AFTER INSERT ON conversations
    FOR EACH ROW
    WHEN NEW.created_at_unix IS NULL OR NEW.updated_at_unix IS NULL
    BEGIN
      UPDATE conversations
      SET
        created_at_unix = unixepoch(created_at),
        updated_at_unix = unixepoch(updated_at)
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_conversations_update_sort_keys
    AFTER UPDATE OF created_at, updated_at ON conversations
    FOR EACH ROW
    BEGIN
      UPDATE conversations
      SET
        created_at_unix = unixepoch(created_at),
        updated_at_unix = unixepoch(updated_at)
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_messages_insert_sort_keys
    AFTER INSERT ON messages
    FOR EACH ROW
    WHEN NEW.created_at_unix IS NULL
    BEGIN
      UPDATE messages
      SET created_at_unix = unixepoch(created_at)
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_messages_update_sort_keys
    AFTER UPDATE OF created_at ON messages
    FOR EACH ROW
    BEGIN
      UPDATE messages
      SET created_at_unix = unixepoch(created_at)
      WHERE id = NEW.id;
    END;
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

      hidden_for_user INTEGER NOT NULL DEFAULT 0,
      hidden_at TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at_unix INTEGER,
      updated_at_unix INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'assistant', 'system')),
      sender_clerk_user_id TEXT,
      body TEXT NOT NULL,
      summary TEXT,
      remote_id TEXT,
      sync_error TEXT,
      synced INTEGER NOT NULL DEFAULT 0,

      deleted_for_user INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at_unix INTEGER,
      FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages_archive (
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'assistant', 'system')),
      sender_clerk_user_id TEXT,
      body TEXT NOT NULL,
      summary TEXT,
      remote_id TEXT,
      sync_error TEXT,
      synced INTEGER NOT NULL DEFAULT 1,

      deleted_for_user INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,

      created_at TEXT NOT NULL,
      created_at_unix INTEGER,
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

    CREATE INDEX IF NOT EXISTS idx_messages_archive_conversation_id
    ON messages_archive (conversation_id);

    CREATE INDEX IF NOT EXISTS idx_messages_archive_created_at
    ON messages_archive (created_at);
  `);

  await migrateContactsToEmailSchema(db);
  await migrateLegacySchema(db);
  await normalizeStoredTimestampText(db);
  await backfillSortableTimestamps(db);
  await createPostMigrationIndexes(db);
}