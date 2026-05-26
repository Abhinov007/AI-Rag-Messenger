import { getDatabase } from './database';

type ArchiveOptions = {
  olderThanDays?: number;
  keepRecentPerConversation?: number;
  batchSize?: number;
};

export async function archiveOldSyncedMessages(options?: ArchiveOptions) {
  const db = await getDatabase();
  const olderThanDays = options?.olderThanDays ?? 30;
  const keepRecentPerConversation = options?.keepRecentPerConversation ?? 200;
  const batchSize = options?.batchSize ?? 250;
  const cutoffUnix = Math.floor(Date.now() / 1000) - olderThanDays * 86400;

  while (true) {
    const rows = await db.getAllAsync<{ id: number }>(
      `
      SELECT m.id
      FROM messages AS m
      WHERE m.synced = 1
        AND m.remote_id IS NOT NULL
        AND m.created_at_unix IS NOT NULL
        AND m.created_at_unix < ?
        AND (
          SELECT COUNT(*)
          FROM messages AS newer
          WHERE newer.conversation_id = m.conversation_id
            AND (
              newer.created_at_unix > m.created_at_unix
              OR (
                newer.created_at_unix = m.created_at_unix
                AND newer.id >= m.id
              )
            )
        ) > ?
      ORDER BY m.created_at_unix ASC, m.id ASC
      LIMIT ?;
      `,
      [cutoffUnix, keepRecentPerConversation, batchSize],
    );

    if (rows.length === 0) {
      return;
    }

    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(', ');

    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `
        INSERT OR IGNORE INTO messages_archive (
          id,
          conversation_id,
          sender_type,
          sender_clerk_user_id,
          body,
          summary,
          remote_id,
          sync_error,
          synced,
          created_at,
          created_at_unix
        )
        SELECT
          id,
          conversation_id,
          sender_type,
          sender_clerk_user_id,
          body,
          summary,
          remote_id,
          sync_error,
          synced,
          created_at,
          created_at_unix
        FROM messages
        WHERE id IN (${placeholders});
        `,
        ids,
      );

      await db.runAsync(
        `
        DELETE FROM messages
        WHERE id IN (${placeholders});
        `,
        ids,
      );
    });
  }
}
