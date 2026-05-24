import { upsertRemoteMessageLocally } from '../db/messageRepository';
import type { MessageSenderType } from '../types/message';
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
  getClerkToken,
}: {
  localConversationId: number;
  remoteConversationId: string;
  getClerkToken: GetClerkToken;
}) {
  const supabase = createSupabaseClient(getClerkToken);

  if (!supabase) {
    console.warn('Remote message pull skipped: Supabase client missing.');
    return;
  }

  const { data, error } = await supabase
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

  if (error) {
    console.warn('Remote message pull failed:', error.message);
    return;
  }

  console.log('Remote messages pulled:', {
    localConversationId,
    remoteConversationId,
    count: data?.length ?? 0,
  });

  for (const message of data ?? []) {
    await upsertRemoteMessageLocally({
      conversationId: localConversationId,
      remoteId: message.id,
      senderType: message.sender_type,
      senderClerkUserId: message.clerk_user_id,
      body: message.body,
      summary: message.summary,
      createdAt: message.created_at,
    });
  }
}   