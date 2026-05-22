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

/**
 * Raw row shape returned by SQLite for the `conversations` table.
 */
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

/**
 * Raw row shape returned by the chat-list query.
 */
type ConversationListRow = ConversationRow & {
  last_message: string | null;
  last_message_at: string | null;
  message_count: number;
};

/**
 * Converts snake_case SQLite columns into the camelCase app type.
 */
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

/**
 * Converts the enriched list query into the UI-friendly conversation item.
 */
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

/**
 * Creates a new conversation and returns its database id.
 */
export async function createConversation(
  conversation: ConversationCreateInput,
): Promise<number> {
  const db = await getDatabase();

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
      synced,
      sync_error
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL);
    `,
    [
      conversation.title?.trim() || null,
      conversation.ownerClerkUserId || null,
      conversation.contactName?.trim() || null,
      conversation.contactEmail?.trim() || null,
      conversation.contactNormalizedEmail?.trim().toLowerCase() || null,
      conversation.contactClerkUserId || null,
    ],
  );

  return Number(result.lastInsertRowId);
}

/**
 * Returns conversations owned by the logged-in Clerk user.
 *
 * This intentionally hides dummy seed conversations because those rows do not
 * have owner_clerk_user_id/contact_normalized_email.
 */
export async function getConversations(
  ownerClerkUserId: string,
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
      COALESCE(conversations.last_message, latest_message.body) AS last_message,
      latest_message.created_at AS last_message_at,
      COUNT(messages.id) AS message_count
    FROM conversations
    LEFT JOIN messages
      ON messages.conversation_id = conversations.id
    LEFT JOIN messages AS latest_message
      ON latest_message.id = (
        SELECT id
        FROM messages
        WHERE conversation_id = conversations.id
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
      )
    WHERE conversations.owner_clerk_user_id = ?
      AND conversations.contact_normalized_email IS NOT NULL
    GROUP BY conversations.id
    ORDER BY datetime(conversations.updated_at) DESC, conversations.id DESC;
    `,
    [ownerClerkUserId],
  );

  return rows.map(mapConversationListItem);
}

/** @deprecated Prefer `getConversations`. */
export async function listConversations(
  ownerClerkUserId: string,
): Promise<ConversationListItem[]> {
  return getConversations(ownerClerkUserId);
}

/**
 * Looks up one conversation by id.
 */
export async function getConversationById(
  id: number,
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
    WHERE id = ?;
    `,
    [id],
  );

  return row ? mapConversation(row) : null;
}

/**
 * Finds an existing contact-linked conversation by owner + normalized email.
 *
 * Used to prevent duplicate chats when the same contact is added again.
 */
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

/** @deprecated Prefer `getConversationById`. */
export async function getConversation(
  conversationId: number,
): Promise<Conversation | null> {
  return getConversationById(conversationId);
}

/**
 * Returns all conversations that still need to be pushed to Supabase.
 */
export async function getUnsyncedConversations(): Promise<Conversation[]> {
  const db = await getDatabase();

  const rows = await db.getAllAsync<ConversationRow>(`
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
    ORDER BY datetime(created_at) ASC, id ASC;
  `);

  return rows.map(mapConversation);
}

/**
 * Marks a local conversation as synced after Supabase returns the remote UUID.
 */
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

/**
 * Stores the latest sync error for a conversation.
 */
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

/**
 * Updates the denormalized last-message preview and bumps `updated_at` so the
 * chat list reflects recent activity even before a new `messages` row exists.
 */
export async function updateConversationLastMessage(
  conversationId: number,
  lastMessage: string,
) {
  const db = await getDatabase();

  await db.runAsync(
    `
    UPDATE conversations
    SET last_message = ?,
        updated_at = CURRENT_TIMESTAMP,
        synced = 0
    WHERE id = ?;
    `,
    [lastMessage.trim(), conversationId],
  );
}

/**
 * Updates a conversation title and refreshes its `updated_at` timestamp.
 */
export async function renameConversation(
  conversationId: number,
  title: string,
) {
  const db = await getDatabase();

  await db.runAsync(
    `
    UPDATE conversations
    SET title = ?,
        updated_at = CURRENT_TIMESTAMP,
        synced = 0
    WHERE id = ?;
    `,
    [title.trim(), conversationId],
  );
}

/**
 * Deletes a conversation. Related messages are removed by the foreign key's
 * `ON DELETE CASCADE` rule.
 */
export async function deleteConversation(conversationId: number) {
  const db = await getDatabase();

  await db.runAsync('DELETE FROM conversations WHERE id = ?;', [conversationId]);
}