/**
 * Data-access helpers for message records.
 */
import { getDatabase } from './database';
import type {
  Message,
  MessageSaveInput,
  MessageSenderType,
} from '../types/message';
import {
  getUtcNowIsoTimestamp,
  normalizeUtcTimestamp,
} from '../utils/timestamps';

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
  deleted_for_user?: number;
  deleted_at?: string | null;
  created_at: string;
  created_at_unix?: number | null;
};

export type MessagePage = {
  messages: Message[];
  hasMore: boolean;
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

/**
 * Adds owner/access protection to queries that read from the live messages table.
 *
 * Important:
 * This helper assumes the base query uses the `messages` table, not
 * `messages_archive`.
 */
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

/**
 * Builds a merged message history query from active messages and archived messages.
 *
 * Deleted messages are filtered out here, so ChatScreen will not show messages
 * that were deleted for the current user.
 */
function buildMessageHistoryQuery(currentClerkUserId?: string) {
  const liveAccessClause = currentClerkUserId
    ? `
      AND EXISTS (
        SELECT 1
        FROM conversations
        WHERE conversations.id = messages.conversation_id
          AND (
            conversations.owner_clerk_user_id = ?
            OR conversations.contact_clerk_user_id = ?
          )
      )
    `
    : '';

  const archiveAccessClause = currentClerkUserId
    ? `
      AND EXISTS (
        SELECT 1
        FROM conversations
        WHERE conversations.id = messages_archive.conversation_id
          AND (
            conversations.owner_clerk_user_id = ?
            OR conversations.contact_clerk_user_id = ?
          )
      )
    `
    : '';

  const accessParams = currentClerkUserId
    ? [currentClerkUserId, currentClerkUserId]
    : [];

  return {
    query: `
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
        deleted_for_user,
        deleted_at,
        created_at,
        created_at_unix
      FROM messages
      WHERE conversation_id = ?
        AND COALESCE(deleted_for_user, 0) = 0
      ${liveAccessClause}

      UNION ALL

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
        deleted_for_user,
        deleted_at,
        created_at,
        created_at_unix
      FROM messages_archive
      WHERE conversation_id = ?
        AND COALESCE(deleted_for_user, 0) = 0
      ${archiveAccessClause}
    `,
    params: [
      ...accessParams,
      ...accessParams,
    ] as Array<string | number>,
  };
}

async function touchConversationAfterMessage(
  db: Awaited<ReturnType<typeof getDatabase>>,
  conversationId: number,
  previewBody: string,
  updatedAt?: string,
) {
  const normalizedUpdatedAt = normalizeUtcTimestamp(updatedAt);

  if (updatedAt) {
    await db.runAsync(
      `
      UPDATE conversations
      SET updated_at = ?,
          last_message = ?
      WHERE id = ?;
      `,
      [normalizedUpdatedAt ?? updatedAt, previewBody, conversationId],
    );

    return;
  }

  const nextUpdatedAt = getUtcNowIsoTimestamp();

  await db.runAsync(
    `
    UPDATE conversations
    SET updated_at = ?,
        last_message = ?
    WHERE id = ?;
    `,
    [nextUpdatedAt, previewBody, conversationId],
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
  const createdAt =
    normalizeUtcTimestamp(message.createdAt) ?? getUtcNowIsoTimestamp();

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
      created_at,
      synced,
      sync_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL);
    `,
    [
      message.conversationId,
      message.senderType,
      senderClerkUserId,
      body,
      summary,
      createdAt,
      synced,
    ],
  );

  const newId = Number(result.lastInsertRowId);
  await touchConversationAfterMessage(db, message.conversationId, body);

  return newId;
}

/**
 * Returns all visible messages for a conversation in chronological order.
 */
export async function getMessagesByConversationId(
  conversationId: number,
  currentClerkUserId?: string,
): Promise<Message[]> {
  const db = await getDatabase();
  const history = buildMessageHistoryQuery(currentClerkUserId);
  const accessParamCount = history.params.length / 2;

  const rows = await db.getAllAsync<MessageRow>(
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
      deleted_for_user,
      deleted_at,
      created_at,
      created_at_unix
    FROM (
      ${history.query}
    )
    ORDER BY created_at_unix ASC, id ASC;
    `,
    [
      conversationId,
      ...history.params.slice(0, accessParamCount),
      conversationId,
      ...history.params.slice(accessParamCount),
    ],
  );

  return rows.map(mapMessage);
}

export async function getMessagePageByConversationId({
  conversationId,
  currentClerkUserId,
  limit,
  beforeCreatedAt,
  beforeId,
}: {
  conversationId: number;
  currentClerkUserId?: string;
  limit: number;
  beforeCreatedAt?: string;
  beforeId?: number;
}): Promise<MessagePage> {
  const db = await getDatabase();
  const history = buildMessageHistoryQuery(currentClerkUserId);
  const accessParamCount = history.params.length / 2;

  const cursorClause =
    beforeCreatedAt && beforeId != null
      ? `
        AND (
          created_at_unix < unixepoch(?)
          OR (created_at_unix = unixepoch(?) AND id < ?)
        )
      `
      : '';

  const fetchLimit = limit + 1;

  const params: Array<string | number> = [
    conversationId,
    ...history.params.slice(0, accessParamCount),
    conversationId,
    ...history.params.slice(accessParamCount),
  ];

  if (beforeCreatedAt && beforeId != null) {
    params.push(beforeCreatedAt, beforeCreatedAt, beforeId);
  }

  params.push(fetchLimit);

  const rows = await db.getAllAsync<MessageRow>(
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
      deleted_for_user,
      deleted_at,
      created_at,
      created_at_unix
    FROM (
      ${history.query}
    )
    WHERE 1 = 1
    ${cursorClause}
    ORDER BY created_at_unix DESC, id DESC
    LIMIT ?;
    `,
    params,
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    messages: pageRows.reverse().map(mapMessage),
    hasMore,
  };
}

/**
 * Returns one visible live message by id.
 *
 * Deleted messages are not returned here.
 */
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
      deleted_for_user,
      deleted_at,
      created_at,
      created_at_unix
    FROM messages
    WHERE id = ?
      AND COALESCE(deleted_for_user, 0) = 0
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

/**
 * Returns unsynced live messages.
 *
 * Do not filter deleted_for_user here.
 * When a user deletes a message, we mark synced = 0 so a future Supabase
 * deletion-sync layer can find it.
 */
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
      deleted_for_user,
      deleted_at,
      created_at,
      created_at_unix
    FROM messages
    WHERE synced = 0
    `,
    currentClerkUserId,
  );

  const rows = await db.getAllAsync<MessageRow>(
    `
    ${scoped.query}
    ORDER BY created_at_unix ASC, id ASC;
    `,
    scoped.params,
  );

  return rows.map(mapMessage);
}

export async function getLatestRemoteMessageCreatedAt(
  conversationId: number,
  currentClerkUserId?: string,
): Promise<string | null> {
  const db = await getDatabase();
  const history = buildMessageHistoryQuery(currentClerkUserId);
  const accessParamCount = history.params.length / 2;

  const row = await db.getFirstAsync<{ created_at: string }>(
    `
    SELECT created_at
    FROM (
      ${history.query}
    )
    WHERE remote_id IS NOT NULL
    ORDER BY created_at_unix DESC, id DESC
    LIMIT 1;
    `,
    [
      conversationId,
      ...history.params.slice(0, accessParamCount),
      conversationId,
      ...history.params.slice(accessParamCount),
    ],
  );

  return row?.created_at ?? null;
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
  const createdAt = getUtcNowIsoTimestamp();

  const result = await db.runAsync(
    `
    INSERT INTO messages (
      conversation_id,
      sender_type,
      sender_clerk_user_id,
      body,
      created_at,
      synced,
      sync_error
    )
    VALUES (?, ?, ?, ?, ?, 0, NULL);
    `,
    [
      conversationId,
      senderType,
      senderClerkUserId ?? null,
      trimmedBody,
      createdAt,
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

  /*
   * Defensive merge:
   * Sometimes a remote message is already pulled into SQLite before the old
   * unsynced local row gets marked with the same remote_id.
   *
   * If we blindly UPDATE remote_id here, SQLite throws:
   * UNIQUE constraint failed: messages.remote_id
   */
  const existingRemoteMessage = await db.getFirstAsync<{ id: number }>(
    `
    SELECT id
    FROM messages
    WHERE remote_id = ?
      AND id != ?
    LIMIT 1;
    `,
    [remoteId, messageId],
  );

  if (existingRemoteMessage?.id) {
    console.warn('Merging duplicate local message after Supabase sync:', {
      messageId,
      existingMessageId: existingRemoteMessage.id,
      remoteId,
    });

    await db.runAsync(
      `
      UPDATE messages
      SET synced = 1,
          sync_error = NULL
      WHERE id = ?;
      `,
      [existingRemoteMessage.id],
    );

    await db.runAsync(
      `
      DELETE FROM messages
      WHERE id = ?;
      `,
      [messageId],
    );

    return;
  }

  const archivedRemoteMessage = await db.getFirstAsync<{ id: number }>(
    `
    SELECT id
    FROM messages_archive
    WHERE remote_id = ?
    LIMIT 1;
    `,
    [remoteId],
  );

  if (archivedRemoteMessage?.id) {
    console.warn('Dropping duplicate local message because remote row is archived:', {
      messageId,
      archivedMessageId: archivedRemoteMessage.id,
      remoteId,
    });

    await db.runAsync(
      `
      DELETE FROM messages
      WHERE id = ?;
      `,
      [messageId],
    );

    return;
  }

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
 * Soft-deletes one message for the current user's local view.
 *
 * This does not delete the whole chat.
 * This does not delete the contact.
 * This does not delete the message for the other participant.
 */
export async function deleteMessageForCurrentUser(
  messageId: number,
): Promise<void> {
  const db = await getDatabase();
  const now = getUtcNowIsoTimestamp();

  await db.runAsync(
    `
    UPDATE messages
    SET deleted_for_user = 1,
        deleted_at = ?,
        synced = 0,
        sync_error = NULL
    WHERE id = ?;
    `,
    [now, messageId],
  );
}

/**
 * Backward-compatible delete function.
 *
 * Old callers may still call deleteMessage(messageId). Keep it, but make it
 * behave as "delete for me" instead of hard-deleting the row.
 */
export async function deleteMessage(messageId: number) {
  await deleteMessageForCurrentUser(messageId);
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
  const normalizedCreatedAt = normalizeUtcTimestamp(createdAt) ?? createdAt;

  const existing = await db.getFirstAsync<{
    id: number;
  }>(
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
          created_at = ?,
          synced = 1,
          sync_error = NULL,
          deleted_for_user = 0,
          deleted_at = NULL
      WHERE id = ?;
      `,
      [
        conversationId,
        senderType,
        senderClerkUserId ?? null,
        body,
        summary ?? null,
        normalizedCreatedAt,
        existing.id,
      ],
    );

    await touchConversationAfterMessage(
      db,
      conversationId,
      body,
      normalizedCreatedAt,
    );

    return existing.id;
  }

  const archived = await db.getFirstAsync<{ id: number }>(
    `
    SELECT id
    FROM messages_archive
    WHERE remote_id = ?
    LIMIT 1;
    `,
    [remoteId],
  );

  if (archived?.id) {
    await touchConversationAfterMessage(
      db,
      conversationId,
      body,
      normalizedCreatedAt,
    );

    return archived.id;
  }

  try {
  console.log('addMessage saving to SQLite:', {
    conversationId,
    senderType,
    senderClerkUserId,
    body: trimmedBody,
    createdAt,
  });

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
        deleted_for_user,
        deleted_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, NULL, 0, NULL, ?);
      `,
      [
        conversationId,
        senderType,
        senderClerkUserId ?? null,
        body,
        summary ?? null,
        remoteId,
        normalizedCreatedAt,
      ],
    );

    await touchConversationAfterMessage(
      db,
      conversationId,
      body,
      normalizedCreatedAt,
    );

    return Number(result.lastInsertRowId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    const isRemoteIdDuplicate =
      message.includes('UNIQUE constraint failed') &&
      message.includes('messages.remote_id');

    if (!isRemoteIdDuplicate) {
      throw error;
    }

    /*
     * Defensive fallback:
     * If another pull/realtime handler inserted the same remote_id between
     * our SELECT and INSERT, update that row instead of crashing.
     */
    const duplicate = await db.getFirstAsync<{ id: number }>(
      `
      SELECT id
      FROM messages
      WHERE remote_id = ?
      LIMIT 1;
      `,
      [remoteId],
    );

    if (!duplicate?.id) {
      throw error;
    }

    await db.runAsync(
      `
      UPDATE messages
      SET conversation_id = ?,
          sender_type = ?,
          sender_clerk_user_id = ?,
          body = ?,
          summary = ?,
          created_at = ?,
          synced = 1,
          sync_error = NULL,
          deleted_for_user = 0,
          deleted_at = NULL
      WHERE id = ?;
      `,
      [
        conversationId,
        senderType,
        senderClerkUserId ?? null,
        body,
        summary ?? null,
        normalizedCreatedAt,
        duplicate.id,
      ],
    );

    await touchConversationAfterMessage(
      db,
      conversationId,
      body,
      normalizedCreatedAt,
    );

    return duplicate.id;
  }
}

export async function clearMessageSyncError(messageId: number): Promise<void> {
  const db = await getDatabase();

  await db.runAsync(
    `
    UPDATE messages
    SET sync_error = NULL
    WHERE id = ?;
    `,
    [messageId],
  );
}