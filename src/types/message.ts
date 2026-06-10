export type MessageSenderType = 'user' | 'assistant' | 'system';

export type Message = {
  id: number;
  conversationId: number;
  senderType: MessageSenderType;
  senderClerkUserId: string | null;
  body: string;
  createdAt: string;
  remoteId: string | null;
  summary: string | null;
  syncError: string | null;
  synced: boolean;
  offlineSynced?: boolean;
};

export type MessageSaveInput = {
  id?: number;
  conversationId: number;
  senderType: MessageSenderType;
  senderClerkUserId?: string | null;
  body: string;
  createdAt?: string;
  summary?: string | null;
  synced?: boolean;
  offlineSynced?: boolean;
};