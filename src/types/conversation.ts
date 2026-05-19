export type Conversation = {
  id: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;

  remoteId?: string | null;
  synced?: boolean;
  syncError?: string | null;
};

/** Payload for `createConversation` before the database assigns id and timestamps. */
export type ConversationCreateInput = Pick<Conversation, 'title'>;

export type ConversationListItem = Conversation & {
  lastMessage: string | null;
  lastMessageAt: string | null;
  messageCount: number;
};