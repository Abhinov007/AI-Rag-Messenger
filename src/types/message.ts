export type MessageSenderType = 'user' | 'assistant' | 'system';

export type Message = {
  id: number;
  conversationId: number;
  senderType: MessageSenderType;
  body: string;
  createdAt: string;
  /** Optional local RAG / sync summary text. */
  summary: string | null;
  /** Whether this row has been persisted to a remote backend. */
  synced: boolean;
};

/** Insert or update payload for `saveMessage` (id omitted or 0 for insert). */
export type MessageSaveInput = {
  id?: number;
  conversationId: number;
  senderType: MessageSenderType;
  body: string;
  createdAt?: string;
  summary?: string | null;
  synced?: boolean;
};