/**
 * Data-access helpers for message records.
 */
import { getDatabase } from './database';
import type { Message, MessageSenderType } from '../types/message';

/**
 * Raw row shape returned by SQLite for the `messages` table.
 */
type MessageRow = {
  id: number;
  conversation_id: number;
  sender_type: MessageSenderType;
  body: string;
  created_at: string;
};

/**
 * Converts snake_case SQLite columns into the camelCase app type.
 */
function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderType: row.sender_type,
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * Adds a message to a conversation and refreshes the parent conversation's
 * `updated_at` timestamp so the chat list order stays current.
 */
export async function addMessage(
  conversationId: number,
  senderType: MessageSenderType,
  body: string,
) {
  const db = await getDatabase();
  const result = await db.runAsync(
    `
    INSERT INTO messages (conversation_id, sender_type, body)
    VALUES (?, ?, ?);
    `,
    conversationId,
    senderType,
    body.trim(),
  );

  await db.runAsync(
    `
    UPDATE conversations
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = ?;
    `,
    conversationId,
  );

  return result.lastInsertRowId;
}

/**
 * Returns all messages for a conversation in chronological order.
 */
export async function listMessages(conversationId: number): Promise<Message[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<MessageRow>(
    `
    SELECT id, conversation_id, sender_type, body, created_at
    FROM messages
    WHERE conversation_id = ?
    ORDER BY datetime(created_at) ASC, id ASC;
    `,
    conversationId,
  );

  return rows.map(mapMessage);
}

/**
 * Deletes one message by id.
 */
export async function deleteMessage(messageId: number) {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM messages WHERE id = ?;', messageId);
}
