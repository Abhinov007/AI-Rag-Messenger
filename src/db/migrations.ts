/**
 * SQLite schema setup for conversations and messages.
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

/**
 * Adds columns introduced after the first app release (no-op if present).
 */
async function migrateLegacySchema(db: SQLiteDatabase) {
  await ensureColumn(db, 'conversations', 'last_message', 'TEXT');
  await ensureColumn(db, 'messages', 'summary', 'TEXT');
  await ensureColumn(db, 'messages', 'remote_id', 'TEXT');
  await ensureColumn(db, 'messages', 'sync_error', 'TEXT');
  await ensureColumn(
    db,
    'messages',
    'synced',
    'INTEGER NOT NULL DEFAULT 0',
  );
}

/**
 * Creates the local conversation tables if they do not already exist.
 */
export async function runMigrations(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      last_message TEXT,
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

  await migrateLegacySchema(db);
}
