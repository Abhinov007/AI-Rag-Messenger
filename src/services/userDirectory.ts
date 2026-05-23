import { createSupabaseClient } from './supabase';

type GetClerkToken = () => Promise<string | null>;

export type AppUser = {
  clerk_user_id: string;
  email: string;
  normalized_email: string;
  display_name: string | null;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function registerCurrentUserInDirectory({
  clerkUserId,
  email,
  displayName,
  getClerkToken,
}: {
  clerkUserId: string;
  email: string;
  displayName?: string | null;
  getClerkToken: GetClerkToken;
}) {
  const supabase = createSupabaseClient(getClerkToken);

  if (!supabase) {
    console.warn('User directory skipped: Supabase client could not be created.');
    return;
  }

  const normalizedEmail = normalizeEmail(email);

  const payload = {
    clerk_user_id: clerkUserId,
    email,
    normalized_email: normalizedEmail,
    display_name: displayName ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('app_users').upsert(payload, {
    onConflict: 'normalized_email',
  });

  if (error) {
    console.warn('Failed to register app user:', error.message);
    return;
  }

  console.log('App user registered in directory:', {
    clerkUserId,
    normalizedEmail,
  });
}

export async function findAppUserByEmail({
  email,
  getClerkToken,
}: {
  email: string;
  getClerkToken: GetClerkToken;
}): Promise<AppUser | null> {
  const supabase = createSupabaseClient(getClerkToken);

  if (!supabase) {
    throw new Error('Supabase client could not be created.');
  }

  const normalizedEmail = normalizeEmail(email);

  const { data, error } = await supabase
    .from('app_users')
    .select('clerk_user_id,email,normalized_email,display_name')
    .eq('normalized_email', normalizedEmail)
    .maybeSingle<AppUser>();

  if (error) {
    throw error;
  }

  return data ?? null;
}