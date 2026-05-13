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
};

/**
 * Raw row shape returned by the chat-list query.
 */
type ConversationListRow = {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
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
    'INSERT INTO conversations (title) VALUES (?);',
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
    'SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?;',
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
    SET last_message = ?, updated_at = CURRENT_TIMESTAMP
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
    SET title = ?, updated_at = CURRENT_TIMESTAMP
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
