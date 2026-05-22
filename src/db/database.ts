/**
 * Opens the app's local SQLite database and creates required tables before
 * repositories execute queries.
 */
import * as SQLite from 'expo-sqlite';
import { runMigrations } from './migrations';

const dbPromise = SQLite.openDatabaseAsync('airag_messenger.db');
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opens SQLite and runs table creation/migration queries once.
 *
 * The init promise is cached so multiple screens can safely request the DB
 * without running setup repeatedly at the same time.
 */
export async function initializeDatabase() {
  if (!initPromise) {
    initPromise = dbPromise.then(async (db) => {
      await runMigrations(db);
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