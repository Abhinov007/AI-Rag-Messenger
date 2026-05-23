import { upsertPulledConversation } from '../db/conversationRepository';
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
  created_at: string;
  updated_at: string;
};

export async function pullRemoteConversations(
  clerkUserId: string,
  getClerkToken: GetClerkToken,
) {
  const supabase = createSupabaseClient(getClerkToken);

  if (!supabase) {
    console.warn('Remote conversation pull skipped: Supabase client missing.');
    return;
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
      created_at,
      updated_at
      `,
    )
    .or(
      `owner_clerk_user_id.eq.${clerkUserId},contact_clerk_user_id.eq.${clerkUserId}`,
    )
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('Remote conversation pull failed:', error.message);
    return;
  }

  console.log('Remote conversations pulled:', {
    clerkUserId,
    count: data?.length ?? 0,
  });

  for (const conversation of data ?? []) {
    await upsertPulledConversation({
      remoteId: conversation.id,
      title: getTitleForCurrentUser(conversation, clerkUserId),
      ownerClerkUserId: conversation.owner_clerk_user_id,
      contactName: conversation.contact_name,
      contactEmail: conversation.contact_email,
      contactNormalizedEmail: conversation.contact_normalized_email,
      contactClerkUserId: conversation.contact_clerk_user_id,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
    });
  }
}

function getTitleForCurrentUser(
  conversation: RemoteConversationRow,
  currentUserId: string,
) {
  if (conversation.owner_clerk_user_id === currentUserId) {
    return conversation.contact_name ?? conversation.title ?? 'New Chat';
  }

  return conversation.title ?? conversation.contact_name ?? 'New Chat';
}