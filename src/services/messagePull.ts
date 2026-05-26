import {
  getLatestRemoteMessageCreatedAt,
  upsertRemoteMessageLocally,
} from '../db/messageRepository';
import type { MessageSenderType } from '../types/message';
import { getErrorMessage } from './serviceErrors';
import { createSupabaseClient } from './supabase';

type GetClerkToken = () => Promise<string | null>;

type RemoteMessageRow = {
  id: string;
  conversation_remote_id: string;
  clerk_user_id: string;
  sender_type: MessageSenderType;
  body: string;
  summary: string | null;
  created_at: string;
};

export async function pullRemoteMessagesForConversation({
  localConversationId,
  remoteConversationId,
  currentClerkUserId,
  getClerkToken,
}: {
  localConversationId: number;
  remoteConversationId: string;
  currentClerkUserId?: string;
  getClerkToken: GetClerkToken;
}) {
  const supabase = createSupabaseClient(getClerkToken);

  if (!supabase) {
    throw new Error('Remote message pull failed: Supabase client missing.');
  }

  const latestRemoteCreatedAt = await getLatestRemoteMessageCreatedAt(
    localConversationId,
    currentClerkUserId,
  );

  let query = supabase
    .from('messages')
    .select(
      `
      id,
      conversation_remote_id,
      clerk_user_id,
      sender_type,
      body,
      summary,
      created_at
      `,
    )
    .eq('conversation_remote_id', remoteConversationId)
    .order('created_at', { ascending: true });

  if (latestRemoteCreatedAt) {
    query = query.gte('created_at', latestRemoteCreatedAt);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Remote message pull failed: ${error.message}`);
  }

  console.log('Remote messages pulled:', {
    localConversationId,
    remoteConversationId,
    latestRemoteCreatedAt,
    count: data?.length ?? 0,
  });

  for (const message of data ?? []) {
    try {
      await upsertRemoteMessageLocally({
        conversationId: localConversationId,
        remoteId: message.id,
        senderType: message.sender_type,
        senderClerkUserId: message.clerk_user_id,
        body: message.body,
        summary: message.summary,
        createdAt: message.created_at,
      });
    } catch (error) {
      throw new Error(
        `Remote message save failed for ${message.id}: ${getErrorMessage(error)}`,
      );
    }
  }
}   
