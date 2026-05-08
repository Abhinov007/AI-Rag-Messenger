import * as SQLite from 'expo-sqlite';

type UserRow = {
  id: number;
  name: string;
  email: string;
};

type AuthResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
    };

const dbPromise = SQLite.openDatabaseAsync('airag_auth.db');

async function getDb() {
  const db = await dbPromise;

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_id INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id)
    );
  `);

  await db.runAsync(
    'INSERT OR IGNORE INTO users (name, email, password) VALUES (?, ?, ?);',
    'Demo User',
    'demo@airag.app',
    'password123',
  );

  return db;
}

export async function getCurrentUser(): Promise<UserRow | null> {
  const db = await getDb();

  return db.getFirstAsync<UserRow>(
    `
    SELECT users.id, users.name, users.email
    FROM session
    JOIN users ON users.id = session.user_id
    WHERE session.id = 1;
    `,
  );
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();
  const user = await db.getFirstAsync<UserRow>(
    'SELECT id, name, email FROM users WHERE lower(email) = lower(?) AND password = ?;',
    normalizedEmail,
    password,
  );

  if (!user) {
    return {
      ok: false,
      error: 'No account matches those credentials.',
    };
  }

  await db.runAsync('DELETE FROM session;');
  await db.runAsync('INSERT INTO session (id, user_id) VALUES (1, ?);', user.id);

  return { ok: true };
}

export async function signup(
  name: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  const db = await getDb();
  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await db.getFirstAsync<UserRow>(
    'SELECT id, name, email FROM users WHERE lower(email) = lower(?);',
    normalizedEmail,
  );

  if (existingUser) {
    return {
      ok: false,
      error: 'An account already exists for this email.',
    };
  }

  const result = await db.runAsync(
    'INSERT INTO users (name, email, password) VALUES (?, ?, ?);',
    name.trim(),
    normalizedEmail,
    password,
  );

  await db.runAsync('DELETE FROM session;');
  await db.runAsync(
    'INSERT INTO session (id, user_id) VALUES (1, ?);',
    result.lastInsertRowId,
  );

  return { ok: true };
}

export async function logout() {
  const db = await getDb();
  await db.runAsync('DELETE FROM session;');
}
