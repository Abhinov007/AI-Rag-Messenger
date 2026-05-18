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
import { createSupabaseClient } from './supabase';

type RemoteMessageRow = {
  id: string;
};

type GetClerkToken = () => Promise<string | null>;

export async function syncMessageById(
  messageId: number,
  clerkUserId: string,
  getClerkToken: GetClerkToken
) {
  const message = await getMessageById(messageId);

  if (!message || message.synced) {
    return;
  }

  await pushMessageToSupabase(message, clerkUserId, getClerkToken);
}

export async function syncPendingMessages(
  clerkUserId: string,
  getClerkToken: GetClerkToken
) {
  const messages = await getUnsyncedMessages();

  console.log('Supabase pending sync check:', {
    pendingCount: messages.length,
  });

  for (const message of messages) {
    await pushMessageToSupabase(message, clerkUserId, getClerkToken);
  }
}

async function pushMessageToSupabase(
  message: Message,
  clerkUserId: string,
  getClerkToken: GetClerkToken
) {
  const supabase = createSupabaseClient(getClerkToken);

  if (!supabase) {
    await markMessageSyncFailed(message.id, 'Supabase client could not be created.');
    console.warn('Supabase sync skipped: client could not be created.');
    return;
  }

  console.log('Trying Supabase sync:', {
    localId: message.id,
    conversationId: message.conversationId,
    clerkUserId,
  });

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
    console.warn('Supabase message sync failed:', error.message);
    return;
  }

  if (data?.id) {
    await markMessageSyncedWithRemoteId(message.id, data.id);
    console.log('Supabase message synced:', {
      localId: message.id,
      remoteId: data.id,
    });
  }
}