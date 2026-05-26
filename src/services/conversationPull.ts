import { upsertPulledConversation } from '../db/conversationRepository';
import { getErrorMessage } from './serviceErrors';
import { createSupabaseClient } from './supabase';

type GetClerkToken = () => Promise<string | null>;

type RemoteConversationRow = {
  id: string;
  clerk_user_id: string | null;
  local_id: number | null;
  title: string | null;

  owner_clerk_user_id: string | null;
  contact_clerk_user_id: string | null;

  contact_name: string | null;
  contact_email: string | null;
  contact_normalized_email: string | null;

  participant_key: string | null;

  created_at: string;
  updated_at: string;
};

type RemoteAppUserRow = {
  clerk_user_id: string;
  email: string;
  normalized_email: string;
  display_name: string | null;
};

export async function pullRemoteConversations(
  clerkUserId: string,
  getClerkToken: GetClerkToken,
) {
  const supabase = createSupabaseClient(getClerkToken);

  if (!supabase) {
    throw new Error('Remote conversation pull failed: Supabase client missing.');
  }

  const { data, error } = await supabase
    .from('conversations')
    .select(
      `
      id,
      clerk_user_id,
      local_id,
      title,
      owner_clerk_user_id,
      contact_clerk_user_id,
      contact_name,
      contact_email,
      contact_normalized_email,
      participant_key,
      created_at,
      updated_at
      `,
    )
    .or(
      `owner_clerk_user_id.eq.${clerkUserId},contact_clerk_user_id.eq.${clerkUserId}`,
    )
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Remote conversation pull failed: ${error.message}`);
  }

  const conversations = data ?? [];

  const participantIds = Array.from(
    new Set(
      conversations
        .flatMap((conversation) => [
          conversation.owner_clerk_user_id,
          conversation.contact_clerk_user_id,
        ])
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const appUsersByClerkId = await fetchAppUsersByClerkId(
    participantIds,
    getClerkToken,
  );

  console.log('Remote conversations pulled:', {
    clerkUserId,
    count: conversations.length,
  });

  for (const conversation of conversations) {
    const title = getTitleForCurrentUser({
      conversation,
      currentUserId: clerkUserId,
      appUsersByClerkId,
    });

    try {
      await upsertPulledConversation({
        remoteId: conversation.id,
        title,

        ownerClerkUserId: conversation.owner_clerk_user_id,

        contactName: conversation.contact_name,
        contactEmail: conversation.contact_email,
        contactNormalizedEmail: conversation.contact_normalized_email,
        contactClerkUserId: conversation.contact_clerk_user_id,

        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
      });
    } catch (error) {
      throw new Error(
        `Remote conversation save failed for ${conversation.id}: ${getErrorMessage(error)}`,
      );
    }
  }
}

async function fetchAppUsersByClerkId(
  clerkUserIds: string[],
  getClerkToken: GetClerkToken,
) {
  const supabase = createSupabaseClient(getClerkToken);
  const map = new Map<string, RemoteAppUserRow>();

  if (!supabase || clerkUserIds.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from('app_users')
    .select('clerk_user_id,email,normalized_email,display_name')
    .in('clerk_user_id', clerkUserIds);

  if (error) {
    throw new Error(
      `Could not fetch app users for conversation titles: ${error.message}`,
    );
  }

  for (const user of data ?? []) {
    map.set(user.clerk_user_id, user);
  }

  return map;
}

function getTitleForCurrentUser({
  conversation,
  currentUserId,
  appUsersByClerkId,
}: {
  conversation: RemoteConversationRow;
  currentUserId: string;
  appUsersByClerkId: Map<string, RemoteAppUserRow>;
}) {
  const isCurrentUserOwner =
    conversation.owner_clerk_user_id === currentUserId;

  const peerClerkUserId = isCurrentUserOwner
    ? conversation.contact_clerk_user_id
    : conversation.owner_clerk_user_id;

  if (isCurrentUserOwner) {
    return (
      conversation.contact_name?.trim() ||
      getDisplayNameFromAppUser(appUsersByClerkId.get(peerClerkUserId ?? '')) ||
      conversation.contact_email?.trim() ||
      conversation.title?.trim() ||
      'New Chat'
    );
  }

  return (
    getDisplayNameFromAppUser(appUsersByClerkId.get(peerClerkUserId ?? '')) ||
    conversation.title?.trim() ||
    conversation.contact_name?.trim() ||
    'New Chat'
  );
}

function getDisplayNameFromAppUser(user?: RemoteAppUserRow) {
  if (!user) {
    return null;
  }

  return (
    user.display_name?.trim() ||
    user.email?.trim() ||
    user.normalized_email?.trim() ||
    null
  );
}
