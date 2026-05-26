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
  sender_clerk_user_id: string | null;
  body: string;
  summary: string | null;
  remote_id: string | null;
  sync_error: string | null;
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
    senderClerkUserId: row.sender_clerk_user_id ?? null,
    body: row.body,
    createdAt: row.created_at,
    remoteId: row.remote_id ?? null,
    summary: row.summary ?? null,
    syncError: row.sync_error ?? null,
    synced: row.synced !== 0,
  };
}

function applyMessageAccessScope(
  baseQuery: string,
  currentClerkUserId?: string,
) {
  if (!currentClerkUserId) {
    return {
      query: baseQuery,
      params: [] as Array<string | number>,
    };
  }

  return {
    query: `
      ${baseQuery}
      AND EXISTS (
        SELECT 1
        FROM conversations
        WHERE conversations.id = messages.conversation_id
          AND (
            conversations.owner_clerk_user_id = ?
            OR conversations.contact_clerk_user_id = ?
          )
      )
    `,
    params: [currentClerkUserId, currentClerkUserId] as Array<string | number>,
  };
}

async function touchConversationAfterMessage(
  db: Awaited<ReturnType<typeof getDatabase>>,
  conversationId: number,
  previewBody: string,
  updatedAt?: string,
) {
  if (updatedAt) {
    await db.runAsync(
      `
      UPDATE conversations
      SET updated_at = ?,
          last_message = ?
      WHERE id = ?;
      `,
      [updatedAt, previewBody, conversationId],
    );

    return;
  }

  await db.runAsync(
    `
    UPDATE conversations
    SET updated_at = CURRENT_TIMESTAMP,
        last_message = ?
    WHERE id = ?;
    `,
    [previewBody, conversationId],
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
  const senderClerkUserId = message.senderClerkUserId ?? null;

  if (message.id != null && message.id > 0) {
    await db.runAsync(
      `
      UPDATE messages
      SET sender_type = ?,
          sender_clerk_user_id = ?,
          body = ?,
          summary = ?,
          synced = ?,
          sync_error = NULL
      WHERE id = ? AND conversation_id = ?;
      `,
      [
        message.senderType,
        senderClerkUserId,
        body,
        summary,
        synced,
        message.id,
        message.conversationId,
      ],
    );

    await touchConversationAfterMessage(db, message.conversationId, body);
    return message.id;
  }

  const result = await db.runAsync(
    `
    INSERT INTO messages (
      conversation_id,
      sender_type,
      sender_clerk_user_id,
      body,
      summary,
      synced,
      sync_error
    )
    VALUES (?, ?, ?, ?, ?, ?, NULL);
    `,
    [
      message.conversationId,
      message.senderType,
      senderClerkUserId,
      body,
      summary,
      synced,
    ],
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
  currentClerkUserId?: string,
): Promise<Message[]> {
  const db = await getDatabase();
  const scoped = applyMessageAccessScope(
    `
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
      created_at
    FROM messages
    WHERE conversation_id = ?
    `,
    currentClerkUserId,
  );

  const rows = await db.getAllAsync<MessageRow>(
    `
    ${scoped.query}
    ORDER BY datetime(created_at) ASC, id ASC;
    `,
    [conversationId, ...scoped.params],
  );

  return rows.map(mapMessage);
}

export async function getMessageById(
  messageId: number,
  currentClerkUserId?: string,
): Promise<Message | null> {
  const db = await getDatabase();
  const scoped = applyMessageAccessScope(
    `
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
      created_at
    FROM messages
    WHERE id = ?
    `,
    currentClerkUserId,
  );

  const row = await db.getFirstAsync<MessageRow>(
    `
    ${scoped.query}
    LIMIT 1;
    `,
    [messageId, ...scoped.params],
  );

  return row ? mapMessage(row) : null;
}

export async function getUnsyncedMessages(
  currentClerkUserId?: string,
): Promise<Message[]> {
  const db = await getDatabase();
  const scoped = applyMessageAccessScope(
    `
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
      created_at
    FROM messages
    WHERE synced = 0
    `,
    currentClerkUserId,
  );

  const rows = await db.getAllAsync<MessageRow>(
    `
    ${scoped.query}
    ORDER BY datetime(created_at) ASC, id ASC;
    `,
    scoped.params,
  );

  return rows.map(mapMessage);
}

/** @deprecated Prefer `getMessagesByConversationId`. */
export async function listMessages(
  conversationId: number,
  currentClerkUserId?: string,
): Promise<Message[]> {
  return getMessagesByConversationId(conversationId, currentClerkUserId);
}

/**
 * Adds a message to a conversation and refreshes the parent conversation's
 * `updated_at` timestamp so the chat list order stays current.
 */
export async function addMessage(
  conversationId: number,
  senderType: MessageSenderType,
  body: string,
  senderClerkUserId?: string | null,
) {
  const db = await getDatabase();
  const trimmedBody = body.trim();

  const result = await db.runAsync(
    `
    INSERT INTO messages (
      conversation_id,
      sender_type,
      sender_clerk_user_id,
      body,
      synced,
      sync_error
    )
    VALUES (?, ?, ?, ?, 0, NULL);
    `,
    [
      conversationId,
      senderType,
      senderClerkUserId ?? null,
      trimmedBody,
    ],
  );

  await touchConversationAfterMessage(db, conversationId, trimmedBody);

  return Number(result.lastInsertRowId);
}

export async function updateMessageSummary(
  messageId: number,
  summary: string,
) {
  const db = await getDatabase();

  await db.runAsync(
    `
    UPDATE messages
    SET summary = ?
    WHERE id = ?;
    `,
    [summary, messageId],
  );
}

export async function markMessageSynced(messageId: number) {
  const db = await getDatabase();

  await db.runAsync(
    `
    UPDATE messages
    SET synced = 1,
        sync_error = NULL
    WHERE id = ?;
    `,
    [messageId],
  );
}

export async function markMessageSyncedWithRemoteId(
  messageId: number,
  remoteId: string,
) {
  const db = await getDatabase();

  await db.runAsync(
    `
    UPDATE messages
    SET synced = 1,
        remote_id = ?,
        sync_error = NULL
    WHERE id = ?;
    `,
    [remoteId, messageId],
  );
}

export async function markMessageSyncFailed(
  messageId: number,
  syncError: string,
) {
  const db = await getDatabase();

  await db.runAsync(
    `
    UPDATE messages
    SET synced = 0,
        sync_error = ?
    WHERE id = ?;
    `,
    [syncError, messageId],
  );
}

/**
 * Deletes one message by id.
 */
export async function deleteMessage(messageId: number) {
  const db = await getDatabase();

  await db.runAsync(
    `
    DELETE FROM messages
    WHERE id = ?;
    `,
    [messageId],
  );
}

export async function upsertRemoteMessageLocally({
  conversationId,
  remoteId,
  senderType,
  senderClerkUserId,
  body,
  summary,
  createdAt,
}: {
  conversationId: number;
  remoteId: string;
  senderType: MessageSenderType;
  senderClerkUserId?: string | null;
  body: string;
  summary?: string | null;
  createdAt: string;
}) {
  const db = await getDatabase();

  const existing = await db.getFirstAsync<{ id: number }>(
    `
    SELECT id
    FROM messages
    WHERE remote_id = ?
    LIMIT 1;
    `,
    [remoteId],
  );

  if (existing?.id) {
    await db.runAsync(
      `
      UPDATE messages
      SET conversation_id = ?,
          sender_type = ?,
          sender_clerk_user_id = ?,
          body = ?,
          summary = ?,
          synced = 1,
          sync_error = NULL
      WHERE id = ?;
      `,
      [
        conversationId,
        senderType,
        senderClerkUserId ?? null,
        body,
        summary ?? null,
        existing.id,
      ],
    );

    await touchConversationAfterMessage(db, conversationId, body, createdAt);

    return existing.id;
  }

  const result = await db.runAsync(
    `
    INSERT INTO messages
    (
      conversation_id,
      sender_type,
      sender_clerk_user_id,
      body,
      summary,
      remote_id,
      synced,
      sync_error,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?);
    `,
    [
      conversationId,
      senderType,
      senderClerkUserId ?? null,
      body,
      summary ?? null,
      remoteId,
      createdAt,
    ],
  );

  await touchConversationAfterMessage(db, conversationId, body, createdAt);

  return Number(result.lastInsertRowId);
}
