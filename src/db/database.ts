/**
 * Opens the app's local SQLite database and runs schema setup once per app
 * session before repositories execute queries.
 */
import * as SQLite from 'expo-sqlite';
import { runMigrations } from './migrations';

const dbPromise = SQLite.openDatabaseAsync('airag_messenger.db');
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Returns the initialized SQLite database.
 *
 * The init promise is cached so multiple screens can safely request the DB
 * without running migrations repeatedly at the same time.
 */
export async function getDatabase() {
  if (!initPromise) {
    initPromise = dbPromise.then(async (db) => {
      await runMigrations(db);
      return db;
    });
  }

  return initPromise;
}
