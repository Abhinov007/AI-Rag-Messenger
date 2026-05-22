export type Conversation = {
  id: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;

  remoteId?: string | null;
  synced?: boolean;
  syncError?: string | null;

  ownerClerkUserId?: string | null;

  contactName?: string | null;
  contactEmail?: string | null;
  contactNormalizedEmail?: string | null;
  contactClerkUserId?: string | null;
};

export type ConversationCreateInput = {
  title: string | null;
  ownerClerkUserId?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactNormalizedEmail?: string | null;
  contactClerkUserId?: string | null;
};

export type ConversationListItem = Conversation & {
  lastMessage: string | null;
  lastMessageAt: string | null;
  messageCount: number;
};