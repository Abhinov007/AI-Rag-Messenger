import { createSupabaseClient } from './supabase';

type GetClerkToken = () => Promise<string | null>;

export type AppUser = {
  clerk_user_id: string;
  email: string;
  normalized_email: string;
  display_name: string | null;
};

/**
 * Normalizes an email address by trimming whitespace and converting to lowercase.
 * @param email - The email address to normalize
 * @returns The normalized email string
 */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * Registers or updates the current user in the app user directory.
 * Creates or updates a user record in Supabase with email and display name.
 * @param clerkUserId - The user's Clerk ID
 * @param email - The user's email address
 * @param displayName - Optional display name for the user
 * @param getClerkToken - Function to get the Clerk authentication token
 */
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

/**
 * Finds an app user by their email address.
 * @param email - The email address to search for
 * @param getClerkToken - Function to get the Clerk authentication token
 * @returns The app user if found, null otherwise
 * @throws Error if Supabase client cannot be created or if the query fails
 */
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