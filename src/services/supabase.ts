/**
 * Supabase client setup.
 *
 * Messages are written to SQLite first, then pushed to Supabase by the sync
 * service when network/backend access is available.
 */
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';



export { isSupabaseConfigured };

type GetClerkToken = () => Promise<string | null>;

export function createSupabaseClient(getClerkToken?: GetClerkToken) {
  if (!isSupabaseConfigured) {
    return null;
  }

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    accessToken: async () => {
      if (!getClerkToken) {
        return null;
      }

      return getClerkToken();
    },
  });
}
