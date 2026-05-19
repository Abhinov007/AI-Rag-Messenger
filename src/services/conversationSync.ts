import { createSupabaseClient } from './supabase';
import {
  getUnsyncedConversations,
  markConversationSyncedWithRemoteId,
  markConversationSyncFailed,
} from '../db/conversationRepository';
import type { Conversation } from '../types/conversation';

type GetClerkToken = () => Promise<string | null>;

type RemoteConversationRow = {
  id: string;
};

export async function syncPendingConversations(
  clerkUserId: string,
  getClerkToken: GetClerkToken,
) {
  const conversations = await getUnsyncedConversations();

  console.log('Supabase pending conversation sync check:', {
    pendingCount: conversations.length,
  });

  for (const conversation of conversations) {
    await pushConversationToSupabase(conversation, clerkUserId, getClerkToken);
  }
}

async function pushConversationToSupabase(
  conversation: Conversation,
  clerkUserId: string,
  getClerkToken: GetClerkToken,
) {
  const supabase = createSupabaseClient(getClerkToken);

  if (!supabase) {
    await markConversationSyncFailed(
      conversation.id,
      'Supabase client could not be created.',
    );

    console.warn('Supabase conversation sync skipped: client could not be created.');
    return;
  }

  console.log('Trying Supabase conversation sync:', {
    localId: conversation.id,
    title: conversation.title,
    clerkUserId,
  });

  const payload = {
    clerk_user_id: clerkUserId,
    local_id: conversation.id,
    title: conversation.title ?? 'New Chat',
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
  };

  const { data, error } = await supabase
    .from('conversations')
    .upsert(payload, {
      onConflict: 'clerk_user_id,local_id',
    })
    .select('id')
    .single<RemoteConversationRow>();

  if (error) {
    const isDuplicateError =
      error.code === '23505' ||
      error.message.includes('duplicate key value') ||
      error.message.includes('conversations_clerk_user_local_id_idx');

    if (isDuplicateError) {
      console.warn(
        'Duplicate conversation found in Supabase. Fetching existing remote row...',
      );

      const { data: existingRow, error: fetchError } = await supabase
        .from('conversations')
        .select('id')
        .eq('clerk_user_id', clerkUserId)
        .eq('local_id', conversation.id)
        .single<RemoteConversationRow>();

      if (fetchError) {
        await markConversationSyncFailed(conversation.id, fetchError.message);

        console.warn(
          'Failed to fetch duplicate Supabase conversation:',
          fetchError.message,
        );

        return;
      }

      if (existingRow?.id) {
        await markConversationSyncedWithRemoteId(
          conversation.id,
          existingRow.id,
        );

        console.log('Recovered duplicate Supabase conversation:', {
          localId: conversation.id,
          remoteId: existingRow.id,
        });

        return;
      }
    }

    await markConversationSyncFailed(conversation.id, error.message);

    console.warn('Supabase conversation sync failed:', error.message);
    return;
  }

  if (data?.id) {
    await markConversationSyncedWithRemoteId(conversation.id, data.id);

    console.log('Supabase conversation synced:', {
      localId: conversation.id,
      remoteId: data.id,
    });
  }
}