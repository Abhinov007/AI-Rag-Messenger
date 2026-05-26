export type ChatMessagePayload = {
  sender: 'user' | 'assistant' | 'system' | 'other';
  body: string;
  createdAt: string;
};

export type AiRequestPayload = {
  conversationId: number;
  title: string;
  messages: ChatMessagePayload[];
};

export type SummarizeResponse = {
  summary: string;
};

export type SuggestReplyResponse = {
  suggestions: string[];
};

export type OllamaGenerateResponse = {
  response?: string;
  done?: boolean;
};
