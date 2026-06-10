import { getDatabase } from '../db/database';
import { getUtcNowIsoTimestamp } from '../utils/timestamps';

type IncomingOfflineChatPayload = {
  clientMessageId: string;
  senderClerkUserId: string;
  recipientClerkUserId: string;
  conversationId?: number;
  participantKey?: string | null;
  body: string;
  createdAt: string;
};

function buildParticipantKey(userA: string, userB: string): string {
  return [userA, userB].sort().join(':');
}

export async function handleIncomingOfflineMessage(
  payload: IncomingOfflineChatPayload,
): Promise<void> {
  const db = await getDatabase();

  const now = getUtcNowIsoTimestamp();

  const createdAt = payload.createdAt || now;

  const participantKey =
    payload.participantKey ??
    buildParticipantKey(payload.senderClerkUserId, payload.recipientClerkUserId);

  const offlineRemoteId = `offline:${payload.senderClerkUserId}:${payload.clientMessageId}`;

  console.log('Saving incoming offline message:', {
    senderClerkUserId: payload.senderClerkUserId,
    recipientClerkUserId: payload.recipientClerkUserId,
    participantKey,
    offlineRemoteId,
    body: payload.body,
  });

  await db.withTransactionAsync(async () => {
    const existingMessage = await db.getFirstAsync<{ id: number }>(
      `
      SELECT id
      FROM messages
      WHERE remote_id = ?
      LIMIT 1;
      `,
      [offlineRemoteId],
    );

    if (existingMessage?.id) {
      console.log('Offline message already exists, skipping duplicate:', {
        offlineRemoteId,
      });
      return;
    }

    let conversation = await db.getFirstAsync<{ id: number }>(
      `
      SELECT id
      FROM conversations
      WHERE participant_key = ?
         OR (
          owner_clerk_user_id = ?
          AND contact_clerk_user_id = ?
         )
      LIMIT 1;
      `,
      [
        participantKey,
        payload.recipientClerkUserId,
        payload.senderClerkUserId,
      ],
    );

    let localConversationId = conversation?.id ?? null;

    if (!localConversationId) {
      const result = await db.runAsync(
        `
        INSERT INTO conversations (
          title,
          last_message,
          owner_clerk_user_id,
          contact_name,
          contact_email,
          contact_normalized_email,
          contact_clerk_user_id,
          participant_key,
          synced,
          sync_error,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 0, NULL, ?, ?);
        `,
        [
          'Offline Contact',
          payload.body,
          payload.recipientClerkUserId,
          'Offline Contact',
          payload.senderClerkUserId,
          participantKey,
          now,
          now,
        ],
      );

      localConversationId = Number(result.lastInsertRowId);

      console.log('Created local conversation for offline message:', {
        localConversationId,
        participantKey,
      });
    }

    await db.runAsync(
      `
      INSERT INTO messages (
        conversation_id,
        sender_type,
        sender_clerk_user_id,
        body,
        summary,
        remote_id,
        sync_error,
        synced,
        created_at
      )
      VALUES (?, 'user', ?, ?, NULL, ?, NULL, 0, ?);
      `,
      [
        localConversationId,
        payload.senderClerkUserId,
        payload.body,
        offlineRemoteId,
        createdAt,
      ],
    );

    await db.runAsync(
      `
      UPDATE conversations
      SET last_message = ?,
          updated_at = ?
      WHERE id = ?;
      `,
      [payload.body, createdAt, localConversationId],
    );

    console.log('Saved incoming offline message:', {
      localConversationId,
      offlineRemoteId,
      body: payload.body,
    });
  });
}