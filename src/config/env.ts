/**
 * Public env vars for Expo.
 *
 * Expo only reliably inlines EXPO_PUBLIC_* values when using direct dot access:
 * process.env.EXPO_PUBLIC_SUPABASE_URL
 */
import Constants from 'expo-constants';

type Extra = {
  clerkPublishableKey?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const extra = Constants.expoConfig?.extra as Extra | undefined;

const clerkPublishableKey =
  clean(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY) ||
  clean(extra?.clerkPublishableKey);

const supabaseUrl =
  clean(process.env.EXPO_PUBLIC_SUPABASE_URL) ||
  clean(extra?.supabaseUrl);

const supabaseAnonKey =
  clean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ||
  clean(process.env.EXPO_PUBLIC_SUPABASE_KEY) ||
  clean(extra?.supabaseAnonKey);

export const env = {
  clerkPublishableKey,
  supabaseUrl,
  supabaseAnonKey,
};

export const isSupabaseConfigured = Boolean(
  env.supabaseUrl && env.supabaseAnonKey
);

console.log('Env check:', {
  hasClerkKey: Boolean(env.clerkPublishableKey),
  hasSupabaseUrl: Boolean(env.supabaseUrl),
  hasSupabaseAnonKey: Boolean(env.supabaseAnonKey),
  isSupabaseConfigured,
});