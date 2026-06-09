import { saveMessage } from '../db/messageRepository';
import { getUtcNowIsoTimestamp } from '../utils/timestamps';

/**
 * This function receives messages from Offline Protocol SDK
 * and stores them locally.
 *
 * You may need to replace getOrCreateConversationFromOfflinePayload()
 * with your actual conversation repository function.
 */
export async function handleIncomingOfflineMessage(payload: {
  clientMessageId: string;
  senderClerkUserId: string;
  recipientClerkUserId: string;
  conversationId?: number;
  participantKey?: string | null;
  body: string;
  createdAt: string;
}) {
  /**
   * TEMP VERSION:
   * If the sender included a local conversationId, that ID may not exist
   * on the receiver's phone.
   *
   * Correct final version:
   * Use participantKey or senderClerkUserId to find/create local conversation.
   */
  const localConversationId = await getOrCreateConversationForOfflineSender({
    senderClerkUserId: payload.senderClerkUserId,
    recipientClerkUserId: payload.recipientClerkUserId,
    participantKey: payload.participantKey ?? null,
  });

  await saveMessage({
    conversationId: localConversationId,
    senderType: 'user',
    senderClerkUserId: payload.senderClerkUserId,
    body: payload.body,
    createdAt: payload.createdAt ?? getUtcNowIsoTimestamp(),
    synced: false,
  });
}

/**
 * Replace this with your actual conversationRepository function.
 *
 * You need a function that:
 * 1. Checks if a conversation already exists for this participant pair.
 * 2. If not, creates one.
 * 3. Returns the local conversation id.
 */
async function getOrCreateConversationForOfflineSender({
  senderClerkUserId,
  recipientClerkUserId,
  participantKey,
}: {
  senderClerkUserId: string;
  recipientClerkUserId: string;
  participantKey: string | null;
}): Promise<number> {
  throw new Error(
    `TODO: implement conversation lookup/create for offline sender ${senderClerkUserId} -> ${recipientClerkUserId}, participantKey=${participantKey}`,
  );
}