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
    (title, synced, sync_error)
    VALUES (?, 0, NULL);
    `,
    conversation.title?.trim() || null,
  );

  return Number(result.lastInsertRowId);
}

/**
 * Returns conversations ordered by most recently updated first, including each
 * row's latest message preview and message count.
 */
export async function getConversations(): Promise<ConversationListItem[]> {
  const db = await getDatabase();

  const rows = await db.getAllAsync<ConversationListRow>(`
    SELECT
      conversations.id,
      conversations.title,
      conversations.created_at,
      conversations.updated_at,
      conversations.remote_id,
      conversations.synced,
      conversations.sync_error,
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
    GROUP BY conversations.id
    ORDER BY datetime(conversations.updated_at) DESC, conversations.id DESC;
  `);

  return rows.map(mapConversationListItem);
}

/** @deprecated Prefer `getConversations`. */
export async function listConversations(): Promise<ConversationListItem[]> {
  return getConversations();
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
      sync_error
    FROM conversations
    WHERE id = ?;
    `,
    id,
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
      sync_error
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
    remoteId,
    conversationId,
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
    error,
    conversationId,
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
    lastMessage.trim(),
    conversationId,
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
    title.trim(),
    conversationId,
  );
}

/**
 * Deletes a conversation. Related messages are removed by the foreign key's
 * `ON DELETE CASCADE` rule.
 */
export async function deleteConversation(conversationId: number) {
  const db = await getDatabase();

  await db.runAsync('DELETE FROM conversations WHERE id = ?;', conversationId);
}