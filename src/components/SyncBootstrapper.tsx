import { useEffect, useMemo, useRef } from 'react';
import { useAuth, useUser } from '@clerk/expo';

import { syncPendingConversations } from '../services/conversationSync';
import { syncPendingMessages } from '../services/messageSync';
import { registerCurrentUserInDirectory } from '../services/userDirectory';
import { pullRemoteConversations } from '../services/conversationPull';
import { getErrorMessage } from '../services/serviceErrors';
import { archiveOldSyncedMessages } from '../db/maintenance';

import {
  setOfflineMeshIncomingMessageHandler,
  startOfflineMesh,
  stopOfflineMesh,
} from '../services/offlineMeshService';

import { handleIncomingOfflineMessage } from '../services/offlineMessageHandler';

export default function SyncBootstrapper() {
  const { userId, getToken, isLoaded } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();

  const lastSyncedUserRef = useRef<string | null>(null);
  const meshStartedUserRef = useRef<string | null>(null);

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

  /**
   * Starts Offline Protocol Mesh after Clerk auth is ready.
   *
   * This is separate from Supabase sync because offline mesh should stay
   * active even if Supabase sync fails.
   */
  useEffect(() => {
    if (!isLoaded || !isUserLoaded || !userId) {
      void stopOfflineMesh();
      meshStartedUserRef.current = null;
      return;
    }

    if (meshStartedUserRef.current === userId) {
      return;
    }

    meshStartedUserRef.current = userId;

    console.log('Starting Offline Mesh for user:', userId);

    setOfflineMeshIncomingMessageHandler(async payload => {
      console.log('Incoming offline message payload:', payload);
    
      try {
        await handleIncomingOfflineMessage(payload);
      } catch (error) {
        console.warn('Failed to save incoming offline message:', getErrorMessage(error));
      }
    });

    void startOfflineMesh(userId).catch(error => {
      meshStartedUserRef.current = null;

      console.warn(
        'Offline Mesh failed to start:',
        getErrorMessage(error),
      );
    });

    return () => {
      console.log('Stopping Offline Mesh for user:', userId);

      meshStartedUserRef.current = null;
      void stopOfflineMesh();
    };
  }, [isLoaded, isUserLoaded, userId]);

  /**
   * Existing Supabase sync bootstrap.
   */
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

        try {
          await archiveOldSyncedMessages();
        } catch (maintenanceError) {
          console.warn(
            'Local message archive maintenance failed:',
            getErrorMessage(maintenanceError),
          );
        }

        console.log('SyncBootstrapper completed');
      } catch (error) {
        console.warn('Initial sync failed:', getErrorMessage(error));
      }
    }

    void runInitialSync();
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