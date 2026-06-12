import type { EstablishmentState } from '@offline-protocol/mesh-sdk';

import { withTimeout } from './withTimeout';

export const SDK_CONN_TIMEOUT_MS = 15_000;

export interface MlsProtocol {
  mlsHasSession(otherUserId: string): Promise<boolean>;
  getEstablishmentState(peerId: string): Promise<EstablishmentState>;
  establishSecureSession(peerId: string): Promise<{ groupId: string } | null>;
}

/**
 * Attempt MLS session establishment with a peer over BLE (no relay required).
 * Returns true when a session exists or was just established.
 */
export async function tryEstablishMls(
  protocol: MlsProtocol,
  peerId: string,
  tag: string,
  timeoutMs: number = SDK_CONN_TIMEOUT_MS,
): Promise<boolean> {
  const hasSession = await withTimeout(protocol.mlsHasSession(peerId), timeoutMs);
  if (hasSession === null) {
    console.warn(`[${tag}] mlsHasSession timed out for`, peerId);
    return false;
  }
  if (hasSession) {
    console.log(`[${tag}] MLS session already exists for`, peerId);
    return true;
  }

  const welcome = await withTimeout(
    protocol.establishSecureSession(peerId),
    timeoutMs,
  );
  if (welcome !== null) {
    console.log(`[${tag}] MLS session established for`, peerId);
    return true;
  }

  const recheck = await withTimeout(protocol.mlsHasSession(peerId), timeoutMs);
  if (recheck === true) {
    console.log(`[${tag}] MLS session exists (race resolved) for`, peerId);
    return true;
  }

  console.warn(`[${tag}] MLS establishment timed out for`, peerId);
  return false;
}

export async function tryEstablishMlsWithRetries(
  protocol: MlsProtocol,
  peerId: string,
  maxAttempts = 3,
  tag = 'OFFLINE',
): Promise<boolean> {
  const baseDelayMs = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.log(
        `[${tag}] Retrying MLS for ${peerId} after ${delay}ms (attempt ${attempt + 1}/${maxAttempts})`,
      );
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }

    const established = await tryEstablishMls(protocol, peerId, tag);
    if (established) {
      return true;
    }
  }

  return false;
}
