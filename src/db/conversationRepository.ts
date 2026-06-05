/**
 * Data-access helpers for conversation records.
 *
 * Screens should use these functions instead of writing SQL directly. That
 * keeps SQLite column names isolated from React component code.
 */
import { getDatabase } from './database';
import type {
  Conversation,
  ConversationCreateInput,
  ConversationListItem,
} from '../types/conversation';
import {
  getUtcNowIsoTimestamp,
  normalizeUtcTimestamp,
} from '../utils/timestamps';

type ConversationRow = {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;

  remote_id: string | null;
  synced: number;
  sync_error: string | null;

  owner_clerk_user_id: string | null;

  contact_name: string | null;
  contact_email: string | null;
  contact_normalized_email: string | null;
  contact_clerk_user_id: string | null;
};

type ConversationListRow = ConversationRow & {
  last_message: string | null;
  last_message_at: string | null;
  message_count: number;
};

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    remoteId: row.remote_id,
    synced: Boolean(row.synced),
    syncError: row.sync_error,

    ownerClerkUserId: row.owner_clerk_user_id,

    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactNormalizedEmail: row.contact_normalized_email,
    contactClerkUserId: row.contact_clerk_user_id,
  };
}

function mapConversationListItem(
  row: ConversationListRow,
): ConversationListItem {
  return {
    ...mapConversation(row),
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at,
    messageCount: row.message_count,
  };
}

function applyConversationAccessScope(
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
      AND (
        owner_clerk_user_id = ?
        OR contact_clerk_user_id = ?
      )
    `,
    params: [currentClerkUserId, currentClerkUserId] as Array<string | number>,
  };
}

export async function createConversation(
  conversation: ConversationCreateInput,
): Promise<number> {
  const db = await getDatabase();
  const createdAt = getUtcNowIsoTimestamp();

  const result = await db.runAsync(
    `
INSERT INTO conversations
(
  title,
  owner_clerk_user_id,
  contact_name,
  contact_email,
  contact_normalized_email,
  contact_clerk_user_id,
  participant_key,
  created_at,
  updated_at,
  synced,
  sync_error,
  hidden_for_user,
  hidden_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, NULL);
    `,
    [
      conversation.title?.trim() || null,
      conversation.ownerClerkUserId || null,
      conversation.contactName?.trim() || null,
      conversation.contactEmail?.trim() || null,
      conversation.contactNormalizedEmail?.trim().toLowerCase() || null,
      conversation.contactClerkUserId || null,
      conversation.participantKey || null,
      createdAt,
      createdAt,
    ],
  );

  return Number(result.lastInsertRowId);
}

export async function getConversations(
  currentClerkUserId: string,
): Promise<ConversationListItem[]> {
  const db = await getDatabase();

  const rows = await db.getAllAsync<ConversationListRow>(
    `
    SELECT
      conversations.id,
      conversations.title,
      conversations.created_at,
      conversations.updated_at,
      conversations.remote_id,
      conversations.synced,
      conversations.sync_error,
      conversations.owner_clerk_user_id,
      conversations.contact_name,
      conversations.contact_email,
      conversations.contact_normalized_email,
      conversations.contact_clerk_user_id,
      COALESCE(
        conversations.last_message,
        (
          SELECT body
          FROM (
            SELECT body, created_at_unix, id
            FROM messages
            WHERE conversation_id = conversations.id
            UNION ALL
            SELECT body, created_at_unix, id
            FROM messages_archive
            WHERE conversation_id = conversations.id
          )
          ORDER BY created_at_unix DESC, id DESC
          LIMIT 1
        )
      ) AS last_message,
      (
        SELECT created_at
        FROM (
          SELECT created_at, created_at_unix, id
          FROM messages
          WHERE conversation_id = conversations.id
          UNION ALL
          SELECT created_at, created_at_unix, id
          FROM messages_archive
          WHERE conversation_id = conversations.id
        )
        ORDER BY created_at_unix DESC, id DESC
        LIMIT 1
      ) AS last_message_at,
      (
        SELECT COUNT(*)
        FROM (
          SELECT id
          FROM messages
          WHERE conversation_id = conversations.id
          UNION ALL
          SELECT id
          FROM messages_archive
          WHERE conversation_id = conversations.id
        )
      ) AS message_count
    FROM conversations
    WHERE (
      conversations.owner_clerk_user_id = ?
      OR conversations.contact_clerk_user_id = ?
    )
    AND conversations.contact_normalized_email IS NOT NULL
    AND COALESCE(conversations.hidden_for_user, 0) = 0
    ORDER BY conversations.updated_at_unix DESC, conversations.id DESC;
    `,
    [currentClerkUserId, currentClerkUserId],
  );

  return rows.map(mapConversationListItem);
}

export async function listConversations(
  currentClerkUserId: string,
): Promise<ConversationListItem[]> {
  return getConversations(currentClerkUserId);
}

export async function getConversationById(
  id: number,
  currentClerkUserId?: string,
): Promise<Conversation | null> {
  const db = await getDatabase();
  const scoped = applyConversationAccessScope(
    `
    SELECT
      id,
      title,
      created_at,
      updated_at,
      remote_id,
      synced,
      sync_error,
      owner_clerk_user_id,
      contact_name,
      contact_email,
      contact_normalized_email,
      contact_clerk_user_id
    FROM conversations
    WHERE id = ?
    `,
    currentClerkUserId,
  );

  const row = await db.getFirstAsync<ConversationRow>(
    `${scoped.query}
    LIMIT 1;
    `,
    [id, ...scoped.params],
  );

  return row ? mapConversation(row) : null;
}

export async function getConversationByContactEmail(
  ownerClerkUserId: string,
  normalizedEmail: string,
): Promise<Conversation | null> {
  const db = await getDatabase();

  const row = await db.getFirstAsync<ConversationRow>(
    `
    SELECT
      id,
      title,
      created_at,
      updated_at,
      remote_id,
      synced,
      sync_error,
      owner_clerk_user_id,
      contact_name,
      contact_email,
      contact_normalized_email,
      contact_clerk_user_id
    FROM conversations
    WHERE owner_clerk_user_id = ?
      AND contact_normalized_email = ?
    LIMIT 1;
    `,
    [ownerClerkUserId, normalizedEmail.trim().toLowerCase()],
  );

  return row ? mapConversation(row) : null;
}

export async function getConversationBetweenUsers(
  currentClerkUserId: string,
  otherClerkUserId: string,
): Promise<Conversation | null> {
  const db = await getDatabase();

  const row = await db.getFirstAsync<ConversationRow>(
    `
    SELECT
      id,
      title,
      created_at,
      updated_at,
      remote_id,
      synced,
      sync_error,
      owner_clerk_user_id,
      contact_name,
      contact_email,
      contact_normalized_email,
      contact_clerk_user_id
    FROM conversations
    WHERE (
      owner_clerk_user_id = ?
      AND contact_clerk_user_id = ?
    )
    OR (
      owner_clerk_user_id = ?
      AND contact_clerk_user_id = ?
    )
    LIMIT 1;
    `,
    [
      currentClerkUserId,
      otherClerkUserId,
      otherClerkUserId,
      currentClerkUserId,
    ],
  );

  return row ? mapConversation(row) : null;
}

export async function getConversation(
  conversationId: number,
  currentClerkUserId?: string,
): Promise<Conversation | null> {
  return getConversationById(conversationId, currentClerkUserId);
}

export async function getUnsyncedConversations(
  currentClerkUserId?: string,
): Promise<Conversation[]> {
  const db = await getDatabase();
  const scoped = applyConversationAccessScope(
    `
    SELECT
      id,
      title,
      created_at,
      updated_at,
      remote_id,
      synced,
      sync_error,
      owner_clerk_user_id,
      contact_name,
      contact_email,
      contact_normalized_email,
      contact_clerk_user_id
    FROM conversations
    WHERE synced = 0
    `,
    currentClerkUserId,
  );

  const rows = await db.getAllAsync<ConversationRow>(
    `
    ${scoped.query}
    ORDER BY created_at_unix ASC, id ASC;
    `,
    scoped.params,
  );

  return rows.map(mapConversation);
}

export async function markConversationSyncedWithRemoteId(
  conversationId: number,
  remoteId: string,
) {
  const db = await getDatabase();

  await db.runAsync(
    `
    UPDATE conversations
    SET synced = 1,
        remote_id = ?,
        sync_error = NULL
    WHERE id = ?;
    `,
    [remoteId, conversationId],
  );
}

export async function markConversationSyncFailed(
  conversationId: number,
  error: string,
) {
  const db = await getDatabase();

  await db.runAsync(
    `
    UPDATE conversations
    SET synced = 0,
        sync_error = ?
    WHERE id = ?;
    `,
    [error, conversationId],
  );
}

export async function updateConversationLastMessage(
  conversationId: number,
  lastMessage: string,
) {
  const db = await getDatabase();
  const updatedAt = getUtcNowIsoTimestamp();

  await db.runAsync(
    `
    UPDATE conversations
    SET last_message = ?,
        updated_at = ?,
        hidden_for_user = 0,
        hidden_at = NULL,
        synced = 0
    WHERE id = ?;
    `,
    [lastMessage.trim(), updatedAt, conversationId],
  );
}

export async function renameConversation(
  conversationId: number,
  title: string,
) {
  const db = await getDatabase();
  const updatedAt = getUtcNowIsoTimestamp();

  await db.runAsync(
    `
    UPDATE conversations
    SET title = ?,
        updated_at = ?,
        synced = 0
    WHERE id = ?;
    `,
    [title.trim(), updatedAt, conversationId],
  );
}

/**
 * User-specific delete.
 *
 * This does not remove the conversation row or messages.
 * It only hides the chat from the current user's chat list.
 */
export async function deleteConversationForCurrentUser(
  conversationId: number,
): Promise<void> {
  const db = await getDatabase();
  const now = getUtcNowIsoTimestamp();

  await db.runAsync(
    `
    UPDATE conversations
    SET hidden_for_user = 1,
        hidden_at = ?,
        updated_at = ?
    WHERE id = ?;
    `,
    [now, now, conversationId],
  );
}

/**
 * Backward-compatible delete function.
 *
 * Keep this name because your UI may already import deleteConversation().
 * Internally, it now performs user-specific soft delete instead of hard delete.
 */
export async function deleteConversation(conversationId: number): Promise<void> {
  await deleteConversationForCurrentUser(conversationId);
}

/**
 * Use this only for debugging/admin cleanup.
 * Do not call this from normal chat delete UI.
 */
export async function permanentlyDeleteConversation(
  conversationId: number,
): Promise<void> {
  const db = await getDatabase();

  await db.runAsync('DELETE FROM conversations WHERE id = ?;', [conversationId]);
}

export async function debugConversationOwners() {
  const db = await getDatabase();

  const rows = await db.getAllAsync(`
    SELECT
      id,
      title,
      owner_clerk_user_id,
      contact_clerk_user_id,
      contact_email,
      contact_normalized_email,
      hidden_for_user,
      hidden_at
    FROM conversations
    ORDER BY id DESC;
  `);

  console.log('Conversation ownership debug:', rows);
}

export async function upsertPulledConversation({
  remoteId,
  title,
  ownerClerkUserId,
  contactName,
  contactEmail,
  contactNormalizedEmail,
  contactClerkUserId,
  createdAt,
  updatedAt,
}: {
  remoteId: string;
  title: string | null;
  ownerClerkUserId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactNormalizedEmail: string | null;
  contactClerkUserId: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  const db = await getDatabase();
  const normalizedCreatedAt = normalizeUtcTimestamp(createdAt) ?? createdAt;
  const normalizedUpdatedAt = normalizeUtcTimestamp(updatedAt) ?? updatedAt;

  const existingByRemoteId = await db.getFirstAsync<{ id: number }>(
    `
    SELECT id
    FROM conversations
    WHERE remote_id = ?
    LIMIT 1;
    `,
    [remoteId],
  );

  if (existingByRemoteId?.id) {
    await db.runAsync(
      `
      UPDATE conversations
      SET title = ?,
          owner_clerk_user_id = ?,
          contact_name = ?,
          contact_email = ?,
          contact_normalized_email = ?,
          contact_clerk_user_id = ?,
          synced = 1,
          sync_error = NULL,
          created_at = ?,
          updated_at = ?
      WHERE id = ?;
      `,
      [
        title,
        ownerClerkUserId,
        contactName,
        contactEmail,
        contactNormalizedEmail,
        contactClerkUserId,
        normalizedCreatedAt,
        normalizedUpdatedAt,
        existingByRemoteId.id,
      ],
    );

    return existingByRemoteId.id;
  }

  const existingBetweenUsers = await db.getFirstAsync<{ id: number }>(
    `
    SELECT id
    FROM conversations
    WHERE (
      owner_clerk_user_id = ?
      AND contact_clerk_user_id = ?
    )
    OR (
      owner_clerk_user_id = ?
      AND contact_clerk_user_id = ?
    )
    LIMIT 1;
    `,
    [
      ownerClerkUserId,
      contactClerkUserId,
      contactClerkUserId,
      ownerClerkUserId,
    ],
  );

  if (existingBetweenUsers?.id) {
    await db.runAsync(
      `
      UPDATE conversations
      SET remote_id = ?,
          title = ?,
          owner_clerk_user_id = ?,
          contact_name = ?,
          contact_email = ?,
          contact_normalized_email = ?,
          contact_clerk_user_id = ?,
          synced = 1,
          sync_error = NULL,
          created_at = ?,
          updated_at = ?
      WHERE id = ?;
      `,
      [
        remoteId,
        title,
        ownerClerkUserId,
        contactName,
        contactEmail,
        contactNormalizedEmail,
        contactClerkUserId,
        normalizedCreatedAt,
        normalizedUpdatedAt,
        existingBetweenUsers.id,
      ],
    );

    return existingBetweenUsers.id;
  }

  const result = await db.runAsync(
    `
    INSERT INTO conversations
    (
      title,
      remote_id,
      owner_clerk_user_id,
      contact_name,
      contact_email,
      contact_normalized_email,
      contact_clerk_user_id,
      synced,
      sync_error,
      hidden_for_user,
      hidden_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, 0, NULL, ?, ?);
    `,
    [
      title,
      remoteId,
      ownerClerkUserId,
      contactName,
      contactEmail,
      contactNormalizedEmail,
      contactClerkUserId,
      normalizedCreatedAt,
      normalizedUpdatedAt,
    ],
  );

  return Number(result.lastInsertRowId);
}