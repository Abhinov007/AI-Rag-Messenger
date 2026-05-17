/**
 * Offline-first message sync.
 *
 * The app always stores messages locally first. These helpers push unsynced
 * local rows to Supabase and mark each local row as synced only after Supabase
 * confirms the insert.
 */
import {
  getMessageById,
  getUnsyncedMessages,
  markMessageSyncFailed,
  markMessageSyncedWithRemoteId,
} from '../db/messageRepository';
import type { Message } from '../types/message';
import { isSupabaseConfigured, supabase } from './supabase';

type RemoteMessageRow = {
  id: string;
};

export async function syncMessageById(messageId: number, clerkUserId: string) {
  const message = await getMessageById(messageId);

  if (!message || message.synced) {
    return;
  }

  await pushMessageToSupabase(message, clerkUserId);
}

export async function syncPendingMessages(clerkUserId: string) {
  const messages = await getUnsyncedMessages();

  for (const message of messages) {
    await pushMessageToSupabase(message, clerkUserId);
  }
}

async function pushMessageToSupabase(message: Message, clerkUserId: string) {
  if (!isSupabaseConfigured || !supabase) {
    await markMessageSyncFailed(message.id, 'Supabase is not configured.');
    return;
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({
      local_id: message.id,
      conversation_id: message.conversationId,
      clerk_user_id: clerkUserId,
      sender_type: message.senderType,
      body: message.body,
      summary: message.summary,
      created_at: message.createdAt,
    })
    .select('id')
    .single<RemoteMessageRow>();

  if (error) {
    await markMessageSyncFailed(message.id, error.message);
    return;
  }

  if (data?.id) {
    await markMessageSyncedWithRemoteId(message.id, data.id);
  }
}
