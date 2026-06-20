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

/**
 * Pulls remote conversations from Supabase for the current user and saves them locally.
 * Fetches conversations where the user is either the owner or contact participant.
 * @param clerkUserId - The current user's Clerk ID
 * @param getClerkToken - Function to get the Clerk authentication token
 * @throws Error if Supabase client is missing or if any conversation fails to save
 */
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
        .flatMap(conversation => [
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
    const localConversation = buildLocalConversationForCurrentUser({
      conversation,
      currentUserId: clerkUserId,
      appUsersByClerkId,
    });

    console.log('Pulled conversation local mapping:', {
      currentUserId: clerkUserId,
      remoteId: conversation.id,
      remoteOwnerClerkUserId: conversation.owner_clerk_user_id,
      remoteContactClerkUserId: conversation.contact_clerk_user_id,
      localOwnerClerkUserId: localConversation.ownerClerkUserId,
      localContactClerkUserId: localConversation.contactClerkUserId,
      title: localConversation.title,
      contactEmail: localConversation.contactEmail,
      participantKey: conversation.participant_key,
    });

    try {
      await upsertPulledConversation({
        remoteId: conversation.id,
        title: localConversation.title,

        /*
         * Local meaning:
         * owner = current logged-in user
         * contact = the other participant
         */
        ownerClerkUserId: localConversation.ownerClerkUserId,
        contactName: localConversation.contactName,
        contactEmail: localConversation.contactEmail,
        contactNormalizedEmail: localConversation.contactNormalizedEmail,
        contactClerkUserId: localConversation.contactClerkUserId,

        participantKey: conversation.participant_key,

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

/**
 * Builds a local conversation representation for the current user from a remote conversation.
 * Determines which user is the owner and which is the contact, and retrieves display information.
 * @param conversation - The remote conversation data
 * @param currentUserId - The ID of the current logged-in user
 * @param appUsersByClerkId - Map of app users indexed by their Clerk IDs
 * @returns Local conversation object with owner/contact perspective adjusted for current user
 */
function buildLocalConversationForCurrentUser({
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

  const peerAppUser = appUsersByClerkId.get(peerClerkUserId ?? '');

  const peerDisplayName =
    getDisplayNameFromAppUser(peerAppUser) ||
    conversation.contact_name?.trim() ||
    conversation.title?.trim() ||
    'New Chat';

  const peerEmail =
    peerAppUser?.email?.trim() ||
    (isCurrentUserOwner ? conversation.contact_email?.trim() : null) ||
    null;

  const peerNormalizedEmail =
    peerAppUser?.normalized_email?.trim().toLowerCase() ||
    (isCurrentUserOwner
      ? conversation.contact_normalized_email?.trim().toLowerCase()
      : null) ||
    peerEmail?.trim().toLowerCase() ||
    null;

  return {
    title: peerDisplayName,
    ownerClerkUserId: currentUserId,
    contactClerkUserId: peerClerkUserId,
    contactName: peerDisplayName,
    contactEmail: peerEmail,
    contactNormalizedEmail: peerNormalizedEmail,
  };
}

/**
 * Fetches app user profiles from Supabase by their Clerk IDs.
 * @param clerkUserIds - Array of Clerk user IDs to fetch
 * @param getClerkToken - Function to get the Clerk authentication token
 * @returns Map of app users indexed by Clerk ID
 * @throws Error if the Supabase query fails
 */
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

/**
 * Extracts the display name from an app user, with fallback to email addresses.
 * @param user - The app user object
 * @returns The display name, email, or null if no suitable value is found
 */
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