import { createSupabaseClient } from './supabase';
import { throwIfFailures } from './serviceErrors';
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
  const conversations = await getUnsyncedConversations(clerkUserId);
  const failures: Error[] = [];

  console.log('Supabase pending conversation sync check:', {
    pendingCount: conversations.length,
  });

  for (const conversation of conversations) {
    try {
      await pushConversationToSupabase(conversation, clerkUserId, getClerkToken);
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error
          : new Error(String(error)),
      );
    }
  }

  throwIfFailures(
    failures,
    'One or more conversations failed to sync to Supabase.',
  );
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

    throw new Error(
      `Supabase conversation sync failed for ${conversation.id}: client could not be created.`,
    );
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

    throw new Error(
      `Supabase conversation sync failed for ${conversation.id}: missing participant data.`,
    );
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
        throw new Error(
          `Failed to recover duplicate Supabase conversation for ${conversation.id}: ${fetchError.message}`,
        );
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
    throw new Error(
      `Supabase conversation sync failed for ${conversation.id}: ${error.message}`,
    );
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
