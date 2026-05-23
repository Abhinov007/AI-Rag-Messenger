import { useEffect, useMemo, useRef } from 'react';
import { useAuth, useUser } from '@clerk/expo';

import { syncPendingConversations } from '../services/conversationSync';
import { syncPendingMessages } from '../services/messageSync';
import { registerCurrentUserInDirectory } from '../services/userDirectory';
import { pullRemoteConversations } from '../services/conversationPull';

export default function SyncBootstrapper() {
  const { userId, getToken, isLoaded } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();

  const lastSyncedUserRef = useRef<string | null>(null);

  const primaryEmail = user?.primaryEmailAddress?.emailAddress ?? null;

  const displayName = useMemo(() => {
    if (user?.fullName?.trim()) {
      return user.fullName.trim();
    }

    if (user?.username?.trim()) {
      return user.username.trim();
    }

    if (primaryEmail) {
      return primaryEmail.split('@')[0];
    }

    return 'User';
  }, [user?.fullName, user?.username, primaryEmail]);

  useEffect(() => {
    async function runInitialSync() {
      console.log('SyncBootstrapper check:', {
        isLoaded,
        isUserLoaded,
        userId,
        primaryEmail,
        displayName,
      });

      if (!isLoaded || !isUserLoaded || !userId) {
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

        if (primaryEmail) {
          await registerCurrentUserInDirectory({
            clerkUserId: userId,
            email: primaryEmail,
            displayName,
            getClerkToken,
          });
        } else {
          console.warn('User directory registration skipped: missing email.');
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
  }, [
    isLoaded,
    isUserLoaded,
    userId,
    getToken,
    primaryEmail,
    displayName,
  ]);

  return null;
}