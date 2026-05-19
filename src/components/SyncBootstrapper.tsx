import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { syncPendingConversations } from '../services/conversationSync';
import { syncPendingMessages } from '../services/messageSync';

export default function SyncBootstrapper() {
  const { userId, getToken, isLoaded } = useAuth();
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

      try {
        console.log('SyncBootstrapper started');

        await syncPendingConversations(userId, getToken);
        await syncPendingMessages(userId, getToken);

        console.log('SyncBootstrapper completed');
      } catch (error) {
        console.warn('Initial sync failed:', error);
      }
    }

    runInitialSync();
  }, [isLoaded, userId, getToken]);

  return null;
}