/**
 * Data-access helpers for message records.
 */
import { getDatabase } from './database';
import type {
  Message,
  MessageSaveInput,
  MessageSenderType,
} from '../types/message';

/**
 * Raw row shape returned by SQLite for the `messages` table.
 */
type MessageRow = {
  id: number;
  conversation_id: number;
  sender_type: MessageSenderType;
  body: string;
  summary: string | null;
  synced: number;
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
    summary: row.summary ?? null,
    synced: row.synced !== 0,
  };
}

async function touchConversationAfterMessage(
  db: Awaited<ReturnType<typeof getDatabase>>,
  conversationId: number,
  previewBody: string,
) {
  await db.runAsync(
    `
    UPDATE conversations
    SET updated_at = CURRENT_TIMESTAMP,
        last_message = ?
    WHERE id = ?;
    `,
    previewBody,
    conversationId,
  );
}

/**
 * Inserts or updates a message row and keeps the parent conversation ordered in
 * the chat list.
 */
export async function saveMessage(message: MessageSaveInput): Promise<number> {
  const db = await getDatabase();
  const body = message.body.trim();
  const summary = message.summary ?? null;
  const synced = message.synced ? 1 : 0;

  if (message.id != null && message.id > 0) {
    await db.runAsync(
      `
      UPDATE messages
      SET sender_type = ?,
          body = ?,
          summary = ?,
          synced = ?
      WHERE id = ? AND conversation_id = ?;
      `,
      message.senderType,
      body,
      summary,
      synced,
      message.id,
      message.conversationId,
    );
    await touchConversationAfterMessage(db, message.conversationId, body);
    return message.id;
  }

  const result = await db.runAsync(
    `
    INSERT INTO messages (conversation_id, sender_type, body, summary, synced)
    VALUES (?, ?, ?, ?, ?);
    `,
    message.conversationId,
    message.senderType,
    body,
    summary,
    synced,
  );

  const newId = Number(result.lastInsertRowId);
  await touchConversationAfterMessage(db, message.conversationId, body);
  return newId;
}

/**
 * Returns all messages for a conversation in chronological order.
 */
export async function getMessagesByConversationId(
  conversationId: number,
): Promise<Message[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<MessageRow>(
    `
    SELECT id, conversation_id, sender_type, body, summary, synced, created_at
    FROM messages
    WHERE conversation_id = ?
    ORDER BY datetime(created_at) ASC, id ASC;
    `,
    conversationId,
  );

  return rows.map(mapMessage);
}

/** @deprecated Prefer `getMessagesByConversationId`. */
export async function listMessages(conversationId: number): Promise<Message[]> {
  return getMessagesByConversationId(conversationId);
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
  return saveMessage({
    conversationId,
    senderType,
    body,
  });
}

export async function updateMessageSummary(
  messageId: number,
  summary: string,
) {
  const db = await getDatabase();
  await db.runAsync('UPDATE messages SET summary = ? WHERE id = ?;', summary, messageId);
}

export async function markMessageSynced(messageId: number) {
  const db = await getDatabase();
  await db.runAsync('UPDATE messages SET synced = 1 WHERE id = ?;', messageId);
}

/**
 * Deletes one message by id.
 */
export async function deleteMessage(messageId: number) {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM messages WHERE id = ?;', messageId);
}
