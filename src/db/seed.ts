/**
 * Dummy conversation data for local development.
 *
 * This gives the chat list something real to render from SQLite before the app
 * has a create-chat screen. A row in `seed_history` prevents the seed from
 * running more than once.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Inserts three dummy conversations and their messages only once.
 */
export async function seedDummyConversations(db: SQLiteDatabase) {
  const existingSeed = await db.getFirstAsync<{ seed_key: string }>(
    'SELECT seed_key FROM seed_history WHERE seed_key = ?;',
    'dummy_conversations_v2',
  );

  if (existingSeed) {
    return;
  }

  await db.runAsync(`
    DELETE FROM conversations
    WHERE title IN ('Project Notes', 'Family', 'Work', 'Rahul', 'Aman', 'Priya');
  `);

  const rahulId = await createSeedConversation(db, 'Rahul');
  await createSeedMessage(
    db,
    rahulId,
    'user',
    'Can you check the deployment issue?',
  );
  await createSeedMessage(
    db,
    rahulId,
    'assistant',
    'I will review the logs and compare the latest build config.',
  );
  await createSeedMessage(
    db,
    rahulId,
    'user',
    'The API health check started failing after the last push.',
  );

  const amanId = await createSeedConversation(db, 'Aman');
  await createSeedMessage(
    db,
    amanId,
    'user',
    'The frontend mapping looks wrong.',
  );
  await createSeedMessage(
    db,
    amanId,
    'assistant',
    'It may be using the old response keys from the API payload.',
  );

  const priyaId = await createSeedConversation(db, 'Priya');
  await createSeedMessage(
    db,
    priyaId,
    'user',
    "Let's summarise today's meeting.",
  );
  await createSeedMessage(
    db,
    priyaId,
    'assistant',
    'Key points: finalize auth, persist chats, and prepare the demo flow.',
  );
  await createSeedMessage(
    db,
    priyaId,
    'user',
    'Please keep the action items short and clear.',
  );

  await db.runAsync(
    'INSERT INTO seed_history (seed_key) VALUES (?);',
    'dummy_conversations_v2',
  );
}

async function createSeedConversation(db: SQLiteDatabase, title: string) {
  const result = await db.runAsync(
    'INSERT INTO conversations (title) VALUES (?);',
    title,
  );

  return result.lastInsertRowId;
}

async function createSeedMessage(
  db: SQLiteDatabase,
  conversationId: number,
  senderType: 'user' | 'assistant' | 'system',
  body: string,
) {
  await db.runAsync(
    `
    INSERT INTO messages (conversation_id, sender_type, body, synced)
    VALUES (?, ?, ?, 1);
    `,
    conversationId,
    senderType,
    body,
  );

  await db.runAsync(
    `
    UPDATE conversations
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = ?;
    `,
    conversationId,
  );
}
