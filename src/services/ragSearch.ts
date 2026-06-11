import { createSupabaseClient } from './supabase';

type GetClerkToken = () => Promise<string | null>;

type RetrievedMessageRow = {
  id: string;
  conversation_remote_id: string;
  clerk_user_id: string;
  sender_type: string;
  body: string;
  created_at: string;
  rank: number;
};

export type RetrievedChatMessage = {
  id: string;
  conversationRemoteId: string;
  senderClerkUserId: string;
  senderType: string;
  body: string;
  createdAt: string;
  rank: number;
};

/**
 * Escapes special regular expression characters in a string for literal matching.
 * @param value - The string to escape
 * @returns The escaped string safe for use in RegExp
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The user is already inside a specific conversation. When they ask:
 * "What did Maa say about Arsenal?"
 * the participant name "Maa" should not be used as a search keyword,
 * because it would match greetings or unrelated messages mentioning Maa.
 *
 * The original question is still preserved for local-Llama answer generation.
 */
function createRetrievalSearchText(
  question: string,
  participantName?: string,
): string {
  const trimmedQuestion = question.trim();
  const trimmedParticipantName = participantName?.trim();

  if (!trimmedParticipantName) {
    return trimmedQuestion;
  }

  const participantPattern = new RegExp(
    `\\b${escapeRegExp(trimmedParticipantName)}\\b`,
    'gi',
  );

  const withoutParticipantName = trimmedQuestion
    .replace(participantPattern, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return withoutParticipantName || trimmedQuestion;
}

/**
 * Searches messages in a conversation using Supabase RAG (Retrieval-Augmented Generation).
 * Filters out participant names from the search query to improve relevance.
 * @param remoteConversationId - The remote conversation ID from Supabase
 * @param question - The user's question or search query
 * @param participantName - Optional name of the conversation participant to exclude from search
 * @param getClerkToken - Function to get the Clerk authentication token
 * @param matchCount - Maximum number of matching messages to return (default: 8)
 * @returns Array of retrieved messages ranked by relevance
 * @throws Error if Supabase is not configured or the search query fails
 */
export async function searchConversationMessages({
  remoteConversationId,
  question,
  participantName,
  getClerkToken,
  matchCount = 8,
}: {
  remoteConversationId: string;
  question: string;
  participantName?: string;
  getClerkToken: GetClerkToken;
  matchCount?: number;
}): Promise<RetrievedChatMessage[]> {
  const trimmedQuestion = question.trim();

  if (!trimmedQuestion) {
    return [];
  }

  const retrievalSearchText = createRetrievalSearchText(
    trimmedQuestion,
    participantName,
  );

  const supabase = createSupabaseClient(getClerkToken);

  if (!supabase) {
    throw new Error('RAG search failed: Supabase is not configured.');
  }

  if (__DEV__) {
    console.log('RAG question:', trimmedQuestion);
    console.log('RAG retrieval search text:', retrievalSearchText);
  }

  const { data, error } = await supabase.rpc(
    'search_conversation_messages',
    {
      p_conversation_remote_id: remoteConversationId,
      p_question: retrievalSearchText,
      p_match_count: matchCount,
    },
  );

  if (error) {
    throw new Error(`RAG search failed: ${error.message}`);
  }

  const rows = (data ?? []) as RetrievedMessageRow[];

  return rows.map((row) => ({
    id: row.id,
    conversationRemoteId: row.conversation_remote_id,
    senderClerkUserId: row.clerk_user_id,
    senderType: row.sender_type,
    body: row.body,
    createdAt: row.created_at,
    rank: row.rank,
  }));
}