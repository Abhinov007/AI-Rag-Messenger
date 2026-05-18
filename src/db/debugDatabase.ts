import { getDatabase } from './database';

type CountRow = {
  count: number;
};

type LatestMessageRow = {
  id: number;
  conversation_id: number;
  sender_type: string;
  body: string;
  synced: number;
  remote_id: string | null;
  sync_error: string | null;
  created_at: string;
};

export async function debugDatabaseHealthCheck() {
  try {
    const db = await getDatabase();

    const conversationCount = await db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) as count FROM conversations;'
    );

    const messageCount = await db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) as count FROM messages;'
    );

    const seedCount = await db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) as count FROM seed_history;'
    );

    const unsyncedCount = await db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) as count FROM messages WHERE synced = 0;'
    );

    const latestMessages = await db.getAllAsync<LatestMessageRow>(
      `
      SELECT
        id,
        conversation_id,
        sender_type,
        body,
        synced,
        remote_id,
        sync_error,
        created_at
      FROM messages
      ORDER BY id DESC
      LIMIT 5;
      `
    );

    console.log('SQLite DB health check:', {
      conversations: conversationCount?.count ?? 0,
      messages: messageCount?.count ?? 0,
      seedHistory: seedCount?.count ?? 0,
      unsyncedMessages: unsyncedCount?.count ?? 0,
      latestMessages,
    });
  } catch (error) {
    console.warn('SQLite DB health check failed:', error);
  }
}