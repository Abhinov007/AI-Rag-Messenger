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

/**
 * SyncBootstrapper Component
 *
 * Bootstraps the synchronization system when the app loads and the user authenticates.
 * Handles three main responsibilities:
 *
 * 1. **Offline Mesh Initialization**: Starts the Offline Protocol (BLE mesh) after Clerk auth is ready.
 *    Persists across React re-renders to avoid tearing down active BLE sessions.
 *
 * 2. **Offline Message Reception**: Sets up the handler for incoming peer-to-peer messages via the mesh protocol.
 *
 * 3. **Supabase Sync**: Performs initial sync operations including:
 *    - Registering the current user in the user directory
 *    - Syncing pending conversations to the server
 *    - Pulling remote conversations from Supabase
 *    - Syncing pending messages to the server
 *    - Archiving old synced messages for local storage efficiency
 *
 * This component renders null and runs only for side effects.
 *
 * @component
 */
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
   * Sets up the handler for incoming offline mesh protocol messages.
   * This handler processes peer-to-peer messages received via Bluetooth Low Energy.
   */
useEffect(() => {
  setOfflineMeshIncomingMessageHandler(async payload => {
    console.log('Incoming offline message payload:', payload);

    try {
      const conversationId =
        typeof payload.conversationId === 'number'
          ? payload.conversationId
          : typeof payload.conversationId === 'string' &&
              Number.isFinite(Number(payload.conversationId))
            ? Number(payload.conversationId)
            : undefined;

      await handleIncomingOfflineMessage({
        clientMessageId: payload.clientMessageId,
        senderClerkUserId: payload.senderClerkUserId,
        recipientClerkUserId: payload.recipientClerkUserId,
        body: payload.body,
        createdAt: payload.createdAt,
        conversationId,
        participantKey: payload.participantKey ?? undefined,
      });
    } catch (error) {
      console.warn(
        'Failed to save incoming offline message:',
        getErrorMessage(error),
      );
    }
  });
}, []);

  /**
   * Manages Offline Protocol Mesh (BLE) lifecycle based on authentication state.
   *
   * Starts the mesh when the user authenticates (userId becomes available).
   * Stops the mesh only on sign-out (userId cleared), not on effect cleanup.
   * This prevents React Strict Mode or component re-renders from tearing down an active BLE session.
   *
   * Uses refs to track which user the mesh is started for, avoiding duplicate startups.
   */
  useEffect(() => {
    if (!isLoaded || !isUserLoaded) {
      return;
    }

    if (!userId) {
      if (meshStartedUserRef.current) {
        console.log('Stopping Offline Mesh after sign-out');
        meshStartedUserRef.current = null;
        void stopOfflineMesh();
      }
      return;
    }

    if (meshStartedUserRef.current === userId) {
      return;
    }

    meshStartedUserRef.current = userId;

    console.log('Starting Offline Mesh for user:', userId);

    void startOfflineMesh(userId).catch(error => {
      meshStartedUserRef.current = null;

      console.warn('Offline Mesh failed to start:', getErrorMessage(error));
    });
  }, [isLoaded, isUserLoaded, userId]);

  /**
   * Performs initial Supabase synchronization on user login.
   *
   * Runs once per authenticated user and includes:
   * - User directory registration
   * - Pending conversation sync
   * - Remote conversation pull
   * - Pending message sync
   * - Local message archival for storage efficiency
   */
  useEffect(() => {
    /**
     * Executes all initial sync operations sequentially.
     * Obtains a fresh Clerk token for each Supabase operation to ensure auth validity.
     */
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