/**
 * Shared message shapes used by the local conversation database.
 */

/**
 * Identifies who created a message.
 *
 * `system` is useful for app-generated notes, summaries, or setup messages.
 */
export type MessageSenderType = 'user' | 'assistant' | 'system';

/**
 * A single message belonging to one conversation.
 */
export type Message = {
  id: number;
  conversationId: number;
  senderType: MessageSenderType;
  body: string;
  createdAt: string;
};
