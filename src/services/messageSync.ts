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
import { throwIfFailures } from './serviceErrors';
import { createSupabaseClient } from './supabase';
import { syncPendingConversations } from './conversationSync';

type RemoteMessageRow = {
  id: string;
};

type GetClerkToken = () => Promise<string | null>;

/**
 * Syncs a single message to Supabase by its ID, if it hasn't been synced yet.
 * @param messageId - The local message ID to sync
 * @param clerkUserId - The current user's Clerk ID
 * @param getClerkToken - Function to get the Clerk authentication token
 * @throws Error if clerkUserId is missing or if the sync fails
 */
export async function syncMessageById(
  messageId: number,
  clerkUserId: string,
  getClerkToken: GetClerkToken,
) {
  if (!clerkUserId) {
    throw new Error('clerkUserId is required to sync a message.');
  }
  const message = await getMessageById(messageId, clerkUserId);

  if (!message || message.synced) {
    return;
  }

  await pushMessageToSupabase(message, clerkUserId, getClerkToken);
}

/**
 * Syncs all unsynced messages for the current user to Supabase.
 * Attempts to push each message and collects any errors that occur.
 * @param clerkUserId - The current user's Clerk ID
 * @param getClerkToken - Function to get the Clerk authentication token
 * @throws AggregateError if one or more messages fail to sync
 */
export async function syncPendingMessages(
  clerkUserId: string,
  getClerkToken: GetClerkToken,
) {
  const messages = await getUnsyncedMessages(clerkUserId);
  const failures: Error[] = [];

  console.log('Supabase pending sync check:', {
    pendingCount: messages.length,
  });

  for (const message of messages) {
    try {
      await pushMessageToSupabase(message, clerkUserId, getClerkToken);
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error
          : new Error(String(error)),
      );
    }
  }

  throwIfFailures(failures, 'One or more messages failed to sync to Supabase.');
}

/**
 * Retrieves the remote conversation ID for a message's conversation, syncing if necessary.
 * @param message - The local message object
 * @param clerkUserId - The current user's Clerk ID
 * @param getClerkToken - Function to get the Clerk authentication token
 * @returns The remote conversation ID, or null if the conversation cannot be synced
 */
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

/**
 * Pushes a single message to Supabase, creating or updating the remote record.
 * Handles duplicate message errors by recovering the existing remote ID.
 * @param message - The local message to push
 * @param clerkUserId - The current user's Clerk ID
 * @param getClerkToken - Function to get the Clerk authentication token
 * @throws Error if the push fails or if the conversation has not been synced
 */
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

    throw new Error(
      `Supabase message sync failed for ${message.id}: client could not be created.`,
    );
  }

  const remoteConversationId = await getRemoteConversationIdForMessage(
    message,
    clerkUserId,
    getClerkToken,
  );

  if (!remoteConversationId) {
    const errorMessage = `Conversation ${message.conversationId} is not synced yet.`;

    await markMessageSyncFailed(message.id, errorMessage);

    throw new Error(
      `Supabase message sync failed for ${message.id}: ${errorMessage}`,
    );
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
    const isNetworkError =
      error.message?.includes('Network request failed') ||
      error.message?.includes('fetch');

    if (isNetworkError) {
      console.warn('Supabase sync deferred: device appears to be offline.', {
        localId: message.id,
      });
      throw error; // Let the caller handle the retry/queue logic.
    }

    console.error('Supabase message sync ERROR:', {
      localId: message.id,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });

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
        throw new Error(
          `Failed to recover duplicate Supabase message for ${message.id}: ${fetchError.message}`,
        );
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
    throw new Error(
      `Supabase message sync failed for ${message.id}: ${error.message}`,
    );
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
