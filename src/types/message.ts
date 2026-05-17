export type MessageSenderType = 'user' | 'assistant' | 'system';

export type Message = {
  id: number;
  conversationId: number;
  senderType: MessageSenderType;
  body: string;
  createdAt: string;
  /** Supabase row id after this local message has synced remotely. */
  remoteId: string | null;
  /** Optional local RAG / sync summary text. */
  summary: string | null;
  /** Last Supabase sync error, if a push failed. */
  syncError: string | null;
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
