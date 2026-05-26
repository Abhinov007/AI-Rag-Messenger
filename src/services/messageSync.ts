/**
 * Offline-first message sync.
 *
 * The app always stores messages locally first. These helpers push unsynced
 * local rows to Supabase and mark each local row as synced only after Supabase
 * confirms the insert/upsert.
 */

import {
  getMessageById,
  getUnsyncedMessages,
  markMessageSyncFailed,
  markMessageSyncedWithRemoteId,
} from '../db/messageRepository';
import { getConversationById } from '../db/conversationRepository';
import type { Message } from '../types/message';
import { createSupabaseClient } from './supabase';
import { syncPendingConversations } from './conversationSync';

type RemoteMessageRow = {
  id: string;
};

type GetClerkToken = () => Promise<string | null>;

export async function syncMessageById(
  messageId: number,
  clerkUserId: string,
  getClerkToken: GetClerkToken,
) {
  const message = await getMessageById(messageId, clerkUserId);

  if (!message || message.synced) {
    return;
  }

  await pushMessageToSupabase(message, clerkUserId, getClerkToken);
}

export async function syncPendingMessages(
  clerkUserId: string,
  getClerkToken: GetClerkToken,
) {
  const messages = await getUnsyncedMessages(clerkUserId);

  console.log('Supabase pending sync check:', {
    pendingCount: messages.length,
  });

  for (const message of messages) {
    await pushMessageToSupabase(message, clerkUserId, getClerkToken);
  }
}

async function getRemoteConversationIdForMessage(
  message: Message,
  clerkUserId: string,
  getClerkToken: GetClerkToken,
): Promise<string | null> {
  let conversation = await getConversationById(
    message.conversationId,
    clerkUserId,
  );
  if (conversation?.remoteId) {
    return conversation.remoteId;
  }

  console.log(
    'Message conversation is not synced yet. Syncing conversations first...',
    {
      localConversationId: message.conversationId,
    },
  );

  await syncPendingConversations(clerkUserId, getClerkToken);

  conversation = await getConversationById(message.conversationId, clerkUserId);

  if (conversation?.remoteId) {
    return conversation.remoteId;
  }

  return null;
}

async function pushMessageToSupabase(
  message: Message,
  clerkUserId: string,
  getClerkToken: GetClerkToken,
) {
  const supabase = createSupabaseClient(getClerkToken);

  if (!supabase) {
    await markMessageSyncFailed(
      message.id,
      'Supabase client could not be created.',
    );

    console.warn('Supabase sync skipped: client could not be created.');
    return;
  }

  const remoteConversationId = await getRemoteConversationIdForMessage(
    message,
    clerkUserId,
    getClerkToken,
  );

  if (!remoteConversationId) {
    const errorMessage = `Conversation ${message.conversationId} is not synced yet.`;

    await markMessageSyncFailed(message.id, errorMessage);

    console.warn('Supabase message sync skipped:', {
      localMessageId: message.id,
      localConversationId: message.conversationId,
      reason: errorMessage,
    });

    return;
  }

  console.log('Trying Supabase sync:', {
    localId: message.id,
    localConversationId: message.conversationId,
    remoteConversationId,
    clerkUserId,
  });

  const payload = {
    local_id: message.id,

    // Keep the local SQLite conversation id for debug/backward compatibility.
    conversation_id: message.conversationId,

    // Proper Supabase conversation UUID link.
    conversation_remote_id: remoteConversationId,

    clerk_user_id: clerkUserId,
    sender_type: message.senderType,
    body: message.body,
    summary: message.summary,
    created_at: message.createdAt,
  };

  const { data, error } = await supabase
    .from('messages')
    .upsert(payload, {
      onConflict: 'clerk_user_id,local_id',
    })
    .select('id')
    .single<RemoteMessageRow>();

  if (error) {
    const isDuplicateError =
      error.code === '23505' ||
      error.message.includes('duplicate key value') ||
      error.message.includes('messages_clerk_user_local_id_idx');

    if (isDuplicateError) {
      console.warn(
        'Duplicate message found in Supabase. Fetching existing remote row...',
      );

      const { data: existingRow, error: fetchError } = await supabase
        .from('messages')
        .select('id')
        .eq('clerk_user_id', clerkUserId)
        .eq('local_id', message.id)
        .single<RemoteMessageRow>();

      if (fetchError) {
        await markMessageSyncFailed(message.id, fetchError.message);

        console.warn(
          'Failed to fetch duplicate Supabase message:',
          fetchError.message,
        );

        return;
      }

      if (existingRow?.id) {
        await markMessageSyncedWithRemoteId(message.id, existingRow.id);

        console.log('Recovered duplicate Supabase message:', {
          localId: message.id,
          remoteId: existingRow.id,
        });

        return;
      }
    }

    await markMessageSyncFailed(message.id, error.message);

    console.warn('Supabase message sync failed:', error.message);
    return;
  }

  if (data?.id) {
    await markMessageSyncedWithRemoteId(message.id, data.id);

    console.log('Supabase message synced:', {
      localId: message.id,
      remoteId: data.id,
      remoteConversationId,
    });
  }
}
