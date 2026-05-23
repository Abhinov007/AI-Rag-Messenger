import { useEffect, useRef } from 'react';
import { useAuth, useUser } from '@clerk/expo';
import { syncPendingConversations } from '../services/conversationSync';
import { syncPendingMessages } from '../services/messageSync';
import { registerCurrentUserInDirectory } from '../services/userDirectory';
import { pullRemoteConversations } from '../services/conversationPull';

export default function SyncBootstrapper() {
  const { userId, getToken, isLoaded } = useAuth();
  const { user } = useUser();
  const lastSyncedUserRef = useRef<string | null>(null);

  useEffect(() => {
    async function runInitialSync() {
      console.log('SyncBootstrapper check:', {
        isLoaded,
        userId,
      });

      if (!isLoaded || !userId) {
        return;
      }

      if (lastSyncedUserRef.current === userId) {
        console.log('SyncBootstrapper skipped: already synced this user');
        return;
      }

      lastSyncedUserRef.current = userId;

      const getClerkToken = async (): Promise<string | null> => {
        const token = await getToken({ template: 'supabase' });
        return typeof token === 'string' ? token : null;
      };

      try {
        console.log('SyncBootstrapper started');

        const email = user?.primaryEmailAddress?.emailAddress;

        if (email) {
          await registerCurrentUserInDirectory({
            clerkUserId: userId,
            email,
            displayName: user?.fullName ?? user?.username ?? null,
            getClerkToken,
          });
        }

        await syncPendingConversations(userId, getClerkToken);
        await pullRemoteConversations(userId, getClerkToken);
        await syncPendingMessages(userId, getClerkToken);   

        console.log('SyncBootstrapper completed');
      } catch (error) {
        console.warn('Initial sync failed:', error);
      }
    }

    runInitialSync();
  }, [isLoaded, userId, getToken, user]);

  return null;
}