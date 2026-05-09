/**
 * SQLite schema setup for conversations and messages.
 *
 * Keep this file focused on table/index creation. Data access belongs in the
 * repository files, and starter demo data belongs in `seed.ts`.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Creates the local conversation tables if they do not already exist.
 */
export async function runMigrations(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'assistant', 'system')),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
    ON conversations (updated_at);

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
    ON messages (conversation_id);

    CREATE INDEX IF NOT EXISTS idx_messages_created_at
    ON messages (created_at);
  `);
}
