/**
 * Shared conversation shapes used by the SQLite repositories and UI screens.
 */

/**
 * A single chat thread stored in the local SQLite database.
 *
 * Date values are SQLite timestamp strings. The UI can format them for display.
 */
export type Conversation = {
  id: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Conversation row enriched with summary fields for the chat list screen.
 */
export type ConversationListItem = Conversation & {
  lastMessage: string | null;
  lastMessageAt: string | null;
  messageCount: number;
};
