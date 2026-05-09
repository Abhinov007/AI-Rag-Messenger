/**
 * Opens the app's local SQLite database, creates required tables, and seeds
 * dummy data once before repositories execute queries.
 */
import * as SQLite from 'expo-sqlite';
import { runMigrations } from './migrations';
import { seedDummyConversations } from './seed';

const dbPromise = SQLite.openDatabaseAsync('airag_messenger.db');
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opens SQLite, runs table creation queries, and seeds dummy conversations once.
 *
 * The init promise is cached so multiple screens can safely request the DB
 * without running setup repeatedly at the same time.
 */
export async function initializeDatabase() {
  if (!initPromise) {
    initPromise = dbPromise.then(async (db) => {
      await runMigrations(db);
      await seedDummyConversations(db);
      return db;
    });
  }

  return initPromise;
}

/**
 * Returns the initialized SQLite database for repository queries.
 */
export async function getDatabase() {
  return initializeDatabase();
}
