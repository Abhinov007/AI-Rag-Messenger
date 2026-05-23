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

function buildParticipantKey(
  ownerClerkUserId?: string | null,
  contactClerkUserId?: string | null,
) {
  if (!ownerClerkUserId || !contactClerkUserId) {
    return null;
  }

  return [ownerClerkUserId, contactClerkUserId].sort().join('__');
}

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

    console.warn(
      'Supabase conversation sync skipped: client could not be created.',
    );

    return;
  }

  const ownerClerkUserId = conversation.ownerClerkUserId ?? clerkUserId;
  const contactClerkUserId = conversation.contactClerkUserId ?? null;

  const participantKey =
    conversation.participantKey ||
    buildParticipantKey(ownerClerkUserId, contactClerkUserId);

  if (!participantKey) {
    await markConversationSyncFailed(
      conversation.id,
      'Conversation is missing participantKey and participant IDs.',
    );

    console.warn('Supabase conversation sync skipped: missing participant data.', {
      localId: conversation.id,
      title: conversation.title,
      ownerClerkUserId,
      contactClerkUserId,
    });

    return;
  }

  console.log('Trying Supabase conversation sync:', {
    localId: conversation.id,
    title: conversation.title,
    clerkUserId,
    participantKey,
    ownerClerkUserId,
    contactClerkUserId,
  });

  const payload = {
    clerk_user_id: clerkUserId,
    local_id: conversation.id,

    title: conversation.title ?? 'New Chat',

    owner_clerk_user_id: ownerClerkUserId,
    contact_clerk_user_id: contactClerkUserId,
    contact_name: conversation.contactName ?? conversation.title ?? null,
    contact_email: conversation.contactEmail ?? null,
    contact_normalized_email: conversation.contactNormalizedEmail ?? null,

    participant_key: participantKey,

    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
  };

  const { data, error } = await supabase
    .from('conversations')
    .upsert(payload, {
      onConflict: 'participant_key',
    })
    .select('id')
    .single<RemoteConversationRow>();

  if (error) {
    const isDuplicateError =
      error.code === '23505' ||
      error.message.includes('duplicate key value') ||
      error.message.includes('participant_key');

    if (isDuplicateError) {
      console.warn(
        'Duplicate participant conversation found in Supabase. Fetching existing remote row...',
      );

      const { data: existingRow, error: fetchError } = await supabase
        .from('conversations')
        .select('id')
        .eq('participant_key', participantKey)
        .maybeSingle<RemoteConversationRow>();

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
          participantKey,
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
      participantKey,
    });
  }
}