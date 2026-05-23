import { upsertRemoteMessageLocally } from '../db/messageRepository';
import type { MessageSenderType } from '../types/message';
import { createSupabaseClient } from './supabase';

type GetClerkToken = () => Promise<string | null>;

type RemoteMessagePayload = {
  id: string;
  conversation_remote_id: string;
  clerk_user_id: string;
  sender_type: MessageSenderType;
  body: string;
  summary: string | null;
  created_at: string;
};

export function subscribeToConversationMessages({
  localConversationId,
  remoteConversationId,
  currentClerkUserId,
  getClerkToken,
  onMessageSaved,
}: {
  localConversationId: number;
  remoteConversationId: string;
  currentClerkUserId: string;
  getClerkToken: GetClerkToken;
  onMessageSaved: () => void;
}) {
  const supabase = createSupabaseClient(getClerkToken);

  if (!supabase) {
    console.warn('Realtime skipped: Supabase client missing.');
    return null;
  }

  const channel = supabase
    .channel(`messages:${remoteConversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_remote_id=eq.${remoteConversationId}`,
      },
      async (payload) => {
        const message = payload.new as RemoteMessagePayload;

        if (!message?.id) {
          return;
        }

        // Own messages are already inserted locally before sync.
        if (message.clerk_user_id === currentClerkUserId) {
          return;
        }

        console.log('Realtime incoming message:', {
          remoteId: message.id,
          body: message.body,
          from: message.clerk_user_id,
        });

        await upsertRemoteMessageLocally({
          conversationId: localConversationId,
          remoteId: message.id,
          senderType: message.sender_type,
          body: message.body,
          summary: message.summary,
          createdAt: message.created_at,
        });

        onMessageSaved();
      },
    )
    .subscribe((status) => {
      console.log('Message realtime status:', {
        remoteConversationId,
        status,
      });
    });

  return channel;
}