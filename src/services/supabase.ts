/**
 * Supabase client setup.
 *
 * Messages are written to SQLite first, then pushed to Supabase by the sync
 * service when network/backend access is available.
 */
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';



export { isSupabaseConfigured };

type GetClerkToken = () => Promise<string | null>;

let sharedSupabaseClient: SupabaseClient | null = null;
let sharedGetClerkToken: GetClerkToken | undefined;

export function createSupabaseClient(getClerkToken?: GetClerkToken) {
  if (!isSupabaseConfigured) {
    return null;
  }

  if (getClerkToken) {
    sharedGetClerkToken = getClerkToken;
  }

  if (sharedSupabaseClient) {
    return sharedSupabaseClient;
  }

  sharedSupabaseClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    accessToken: async () => {
      if (!sharedGetClerkToken) {
        return null;
      }

      return sharedGetClerkToken();
    },
  });

  return sharedSupabaseClient;
}

export function resetSupabaseClientState() {
  sharedGetClerkToken = undefined;
}
