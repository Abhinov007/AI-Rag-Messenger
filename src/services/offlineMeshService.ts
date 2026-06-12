import { OfflineProtocol, MessagePriority } from '@offline-protocol/mesh-sdk';
import { Platform } from 'react-native';

import { tryEstablishMlsWithRetries } from '../utils/mlsRecovery';
import { requestOfflineMeshPermissions } from './offlinePermissions';

let protocol: OfflineProtocol | null = null;
let currentUserId: string | null = null;

let status: 'idle' | 'starting' | 'running' | 'stopped' | 'permission_denied' =
  'idle';

/** Peers seen via neighbor_discovered. */
const discoveredPeers = new Map<string, number>();
/** Peers whose BLE data link finished handshake (MTU flushed to Rust). */
const linkReadyPeers = new Set<string>();
/** Peers with an MLS secure session. */
const secureSessionPeers = new Set<string>();

const pendingMessages = new Map<
  string,
  {
    recipient: string;
    content: string;
    localMessageId?: number;
  }
>();

const deliveryWaiters = new Map<
  string,
  {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

const peerSubscribers = new Set<(peers: string[]) => void>();
const peerReadySubscribers = new Set<(readyPeers: string[]) => void>();

/** Delay after neighbor_discovered before MLS / send (BLE stack needs time). */
const POST_DISCOVERY_HANDSHAKE_DELAY_MS = 2500;
const DEFAULT_DELIVERY_TIMEOUT_MS = 60_000;
const DEFAULT_PEER_READY_TIMEOUT_MS = 45_000;

type IncomingMeshMessage = {
  clientMessageId: string;
  senderClerkUserId: string;
  recipientClerkUserId: string;
  body: string;
  createdAt: string;
  conversationId?: number;
  participantKey?: string;
};

type SendOfflineChatMessageParams = {
  recipientId?: string;
  recipientClerkUserId?: string;
  senderClerkUserId?: string;

  localMessageId?: string | number;
  clientMessageId?: string;

  conversationId?: string | number;
  participantKey?: string | null;

  body?: string;
  content?: string;
  text?: string;

  createdAt?: string;
  waitForDelivery?: boolean;
  deliveryTimeoutMs?: number;
  skipPeerReady?: boolean;

  [key: string]: unknown;
};

let incomingMessageHandler:
  | ((message: IncomingMeshMessage) => void | Promise<void>)
  | null = null;

export function setOfflineMeshIncomingMessageHandler(
  handler: typeof incomingMessageHandler,
) {
  incomingMessageHandler = handler;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getReadyPeerIds(): string[] {
  return Array.from(discoveredPeers.keys()).filter(peerId =>
    isOfflineMeshPeerReady(peerId),
  );
}

function notifyPeerSubscribers() {
  const peers = getOfflineMeshKnownPeers();
  peerSubscribers.forEach(listener => {
    listener(peers);
  });
}

function notifyPeerReadySubscribers() {
  const readyPeers = getReadyPeerIds();
  peerReadySubscribers.forEach(listener => {
    listener(readyPeers);
  });
}

function markPeerLinkReady(peerId: string) {
  if (!peerId || !discoveredPeers.has(peerId)) {
    return;
  }

  if (!linkReadyPeers.has(peerId)) {
    linkReadyPeers.add(peerId);
    console.log('[OFFLINE] Peer link ready:', peerId);
    notifyPeerReadySubscribers();
  }
}

function markPeerSecureSession(peerId: string) {
  if (!peerId) {
    return;
  }

  secureSessionPeers.add(peerId);
  linkReadyPeers.add(peerId);
  notifyPeerReadySubscribers();
}

function clearPeerState(peerId: string) {
  discoveredPeers.delete(peerId);
  linkReadyPeers.delete(peerId);
  secureSessionPeers.delete(peerId);
  notifyPeerSubscribers();
  notifyPeerReadySubscribers();
}

function buildIncomingPayloadFromEvent(event: any): IncomingMeshMessage {
  let parsedPayload: any = null;

  try {
    parsedPayload = JSON.parse(String(event.content));
  } catch {
    parsedPayload = null;
  }

  return {
    clientMessageId:
      parsedPayload?.clientMessageId ??
      event.message_id ??
      `mesh_${Date.now()}`,

    senderClerkUserId:
      parsedPayload?.senderClerkUserId ??
      event.sender ??
      '',

    recipientClerkUserId:
      parsedPayload?.recipientClerkUserId ??
      event.recipient ??
      currentUserId ??
      '',

    body:
      parsedPayload?.body ??
      String(event.content ?? ''),

    createdAt:
      parsedPayload?.createdAt ??
      new Date().toISOString(),

    conversationId: toNumberOrUndefined(parsedPayload?.conversationId),

    participantKey:
      typeof parsedPayload?.participantKey === 'string'
        ? parsedPayload.participantKey
        : undefined,
  };
}

function resolveDeliveryWaiter(messageId: string, error?: Error) {
  const waiter = deliveryWaiters.get(messageId);
  if (!waiter) {
    return;
  }

  clearTimeout(waiter.timeout);
  deliveryWaiters.delete(messageId);

  if (error) {
    waiter.reject(error);
  } else {
    waiter.resolve();
  }
}

export function waitForOfflineMeshDelivery(
  meshMessageId: string,
  timeoutMs = DEFAULT_DELIVERY_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      deliveryWaiters.delete(meshMessageId);
      reject(
        new Error(
          `Mesh delivery timed out after ${timeoutMs}ms for message ${meshMessageId}`,
        ),
      );
    }, timeoutMs);

    deliveryWaiters.set(meshMessageId, {
      resolve,
      reject,
      timeout,
    });
  });
}

function registerOfflineMeshListeners(activeProtocol: OfflineProtocol) {
  activeProtocol.on('diagnostic', (event: any) => {
    const level = String(event.level ?? 'info').toUpperCase();
    const message = String(event.message ?? '');
    const context = event.context ?? {};

    console.log(`[OFFLINE DIAGNOSTIC]`, { level, message, context });

    if (message === 'BLE per-peer MTU flushed to Rust') {
      const deviceId =
        typeof context.deviceId === 'string' ? context.deviceId : null;
      if (deviceId) {
        markPeerLinkReady(deviceId);
      }
    }
  });

  activeProtocol.on('neighbor_discovered', (event: any) => {
    console.log(
      `[PEER FOUND] ${event.peer_id} via ${event.transport}, RSSI: ${event.rssi}`,
    );
    discoveredPeers.set(event.peer_id, event.rssi ?? -100);
    notifyPeerSubscribers();
  });

  activeProtocol.on('neighbor_lost', (event: any) => {
    console.log(`[PEER LOST] ${event.peer_id}`);
    clearPeerState(event.peer_id);
  });

  activeProtocol.on('message_sent', (event: any) => {
    console.log(`[SENT] Message ${event.message_id} to ${event.recipient}`);

    const existing = pendingMessages.get(event.message_id);
    pendingMessages.set(event.message_id, {
      recipient: event.recipient,
      content: event.content,
      localMessageId: existing?.localMessageId,
    });
  });

  activeProtocol.on('message_delivered', (event: any) => {
    console.log(
      `[DELIVERED] Message ${event.message_id} in ${event.latency_ms}ms, ${event.hop_count} hops via ${event.transport}`,
    );

    pendingMessages.delete(event.message_id);
    resolveDeliveryWaiter(event.message_id);
  });

  activeProtocol.on('message_failed', (event: any) => {
    console.log(
      `[FAILED] Message ${event.message_id}: ${event.reason} (${event.retry_count} retries)`,
    );

    pendingMessages.delete(event.message_id);
    resolveDeliveryWaiter(
      event.message_id,
      new Error(event.reason ?? 'Mesh message failed'),
    );
  });

  activeProtocol.on('message_deferred', (event: any) => {
    console.log(
      `[DEFERRED] Message ${event.message_id}: ${event.reason} (retry ${event.retry_count})`,
    );
  });

  activeProtocol.on('message_received', (event: any) => {
    console.log(`[RECEIVED] From ${event.sender}: ${event.content}`);
    console.log(`  - Message ID: ${event.message_id}`);
    console.log(`  - Hop count: ${event.hop_count}`);
    console.log(`  - Transport: ${event.transport}`);
    console.log(`  - Encrypted: ${event.encrypted}`);

    incomingMessageHandler?.(buildIncomingPayloadFromEvent(event));
  });

  activeProtocol.on('secure_session_established', (event: any) => {
    console.log(
      `[SECURE] Session established with ${event.peer_id} group: ${event.group_id}`,
    );
    markPeerSecureSession(event.peer_id);
  });

  activeProtocol.on('secure_session_failed', (event: any) => {
    console.warn(
      `[SECURE FAILED] Peer ${event.peer_id}: ${event.reason ?? 'unknown'}`,
    );
  });

  activeProtocol.on('transport_switched', (event: any) => {
    console.log(
      `[TRANSPORT] Switched from ${event.from} to ${event.to}: ${event.reason ?? event.reason_detail ?? ''}`,
    );
  });

  activeProtocol.on('connection_request_received', (event: any) => {
    console.log(
      `[CONNECTION] Request from ${event.sender_name} (${event.sender})`,
    );
  });

  activeProtocol.on('connection_accepted', (event: any) => {
    console.log(`[CONNECTION] Accepted by ${event.accepted_by_name}`);
  });
}

export async function ensureOfflineMeshPeerReady(
  peerId: string,
  timeoutMs = DEFAULT_PEER_READY_TIMEOUT_MS,
): Promise<void> {
  if (!protocol || status !== 'running') {
    throw new Error('Offline mesh is not running.');
  }

  if (isOfflineMeshPeerReady(peerId)) {
    return;
  }

  const discovered = await waitForOfflinePeer(peerId, timeoutMs);
  if (!discovered) {
    throw new Error(`Peer ${peerId} was not discovered nearby within ${timeoutMs}ms`);
  }

  console.log('[OFFLINE] Waiting for BLE handshake after discovery:', peerId);
  await delay(POST_DISCOVERY_HANDSHAKE_DELAY_MS);

  const mlsEstablished = await tryEstablishMlsWithRetries(
    protocol,
    peerId,
    3,
    'OFFLINE',
  );

  if (mlsEstablished) {
    markPeerSecureSession(peerId);
    return;
  }

  // requireEncryption is false — allow send after discovery + handshake delay
  // even if MLS key exchange has not completed yet.
  if (!linkReadyPeers.has(peerId)) {
    console.warn(
      '[OFFLINE] MLS not ready and BLE link-ready signal missing; proceeding with best-effort send for',
      peerId,
    );
    markPeerLinkReady(peerId);
  }
}

export async function startOfflineMesh(clerkUserId: string): Promise<void> {
  if (protocol && currentUserId === clerkUserId && status === 'running') {
    return;
  }

  status = 'starting';

  const hasPermission = await requestOfflineMeshPermissions();

  if (!hasPermission) {
    status = 'permission_denied';
    throw new Error('Bluetooth permissions are required for offline messaging.');
  }

  if (protocol) {
    await stopOfflineMesh();
  }

  currentUserId = clerkUserId;

  protocol = new OfflineProtocol({
    appId: 'airag-messenger',
    userId: clerkUserId,

    transports: {
      ble: { enabled: true },

      internet: {
        enabled: false,
      },

      wifiDirect: {
        enabled: Platform.OS === 'android',
      },
    },

    encryption: {
      enabled: true,
      autoKeyExchange: true,
      storePending: true,
      requireEncryption: false,
      pendingQueue: {
        maxPendingPerPeer: 64,
        maxPendingGlobal: 4096,
        pendingTtlMs: 120000,
        overflowPolicy: 'drop_oldest',
      },
    },

    relay: {
      allowRelay: true,
      minBatteryForRelay: 30,
      relayPriority: 'auto',
    },
  });

  registerOfflineMeshListeners(protocol);

  await protocol.start();

  status = 'running';

  console.log('Offline mesh started for:', clerkUserId);
}

export async function sendOfflineMeshMessage(params: {
  recipientId: string;
  content: string;
  localMessageId?: number;
}): Promise<string> {
  if (!protocol || status !== 'running') {
    throw new Error('Offline mesh is not running.');
  }

  const messageId = await protocol.sendMessage({
    recipient: params.recipientId,
    content: params.content,
    priority: MessagePriority.High,
  });

  pendingMessages.set(messageId, {
    recipient: params.recipientId,
    content: params.content,
    localMessageId: params.localMessageId,
  });

  console.log(`Message queued with ID: ${messageId}`);

  return messageId;
}

export async function sendOfflineChatMessage(
  params: SendOfflineChatMessageParams | string,
  maybeText?: string,
): Promise<string> {
  const recipientId =
    typeof params === 'string'
      ? params
      : params.recipientId ?? params.recipientClerkUserId;

  const senderId =
    typeof params === 'string'
      ? currentUserId
      : params.senderClerkUserId ?? currentUserId;

  const body =
    typeof params === 'string'
      ? maybeText
      : params.body ?? params.content ?? params.text;

  const waitForDelivery =
    typeof params === 'string' ? false : params.waitForDelivery ?? false;

  const deliveryTimeoutMs =
    typeof params === 'string'
      ? DEFAULT_DELIVERY_TIMEOUT_MS
      : params.deliveryTimeoutMs ?? DEFAULT_DELIVERY_TIMEOUT_MS;

  const skipPeerReady =
    typeof params === 'string' ? false : params.skipPeerReady ?? false;

  const generatedClientMessageId = `mesh_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;

  const clientMessageId =
    typeof params === 'string'
      ? generatedClientMessageId
      : params.clientMessageId ??
        (params.localMessageId !== undefined
          ? String(params.localMessageId)
          : generatedClientMessageId);

  const localMessageId =
    typeof params === 'string'
      ? undefined
      : toNumberOrUndefined(params.localMessageId);

  if (!recipientId) {
    throw new Error('Missing recipientId for offline chat message.');
  }

  if (!body) {
    throw new Error('Missing body/content for offline chat message.');
  }

  if (!skipPeerReady) {
    await ensureOfflineMeshPeerReady(recipientId);
  }

  const payload: IncomingMeshMessage = {
    clientMessageId,
    senderClerkUserId: senderId ?? '',
    recipientClerkUserId: recipientId,
    body,
    createdAt:
      typeof params === 'string'
        ? new Date().toISOString()
        : params.createdAt ?? new Date().toISOString(),

    conversationId:
      typeof params === 'string'
        ? undefined
        : toNumberOrUndefined(params.conversationId),

    participantKey:
      typeof params === 'string'
        ? undefined
        : params.participantKey ?? undefined,
  };

  const meshMessageId = await sendOfflineMeshMessage({
    recipientId,
    content: JSON.stringify(payload),
    localMessageId,
  });

  if (waitForDelivery) {
    await waitForOfflineMeshDelivery(meshMessageId, deliveryTimeoutMs);
  }

  return meshMessageId;
}

export async function sendOfflineDebugPing(
  recipientId: string,
): Promise<string> {
  return sendOfflineChatMessage({
    recipientClerkUserId: recipientId,
    body: `DEBUG_PING:${new Date().toISOString()}`,
    waitForDelivery: true,
  });
}

export async function sendOfflinePlainTextPing(
  recipientId: string,
): Promise<string> {
  return sendOfflineDebugPing(recipientId);
}

export async function waitForOfflinePeer(
  peerId: string,
  timeoutMs = 30000,
): Promise<boolean> {
  if (!protocol) {
    return false;
  }

  if (discoveredPeers.has(peerId)) {
    return true;
  }

  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      protocol?.off('neighbor_discovered', handler);
      resolve(false);
    }, timeoutMs);

    const handler = (event: any) => {
      if (event.peer_id === peerId) {
        clearTimeout(timeout);
        protocol?.off('neighbor_discovered', handler);
        resolve(true);
      }
    };

    protocol?.on('neighbor_discovered', handler);
  });
}

export async function waitForOfflineMeshPeer(
  peerId: string,
  timeoutMs = 30000,
): Promise<boolean> {
  return waitForOfflinePeer(peerId, timeoutMs);
}

export async function waitForOfflineMeshPeerReady(
  peerId: string,
  timeoutMs = DEFAULT_PEER_READY_TIMEOUT_MS,
): Promise<boolean> {
  try {
    await ensureOfflineMeshPeerReady(peerId, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

export function hasOfflineMeshPeer(peerId: string): boolean {
  return discoveredPeers.has(peerId);
}

export function isOfflineMeshPeerReady(peerId: string): boolean {
  return (
    discoveredPeers.has(peerId) &&
    (linkReadyPeers.has(peerId) || secureSessionPeers.has(peerId))
  );
}

export function hasOfflineMeshPeerReady(peerId: string): boolean {
  return isOfflineMeshPeerReady(peerId);
}

export function getOfflineMeshKnownPeers(): string[] {
  return Array.from(discoveredPeers.keys());
}

export function getOfflineMeshReadyPeers(): string[] {
  return getReadyPeerIds();
}

export function getDiscoveredOfflinePeers(): string[] {
  return getOfflineMeshKnownPeers();
}

export function subscribeOfflineMeshPeers(
  listener: (peers: string[]) => void,
): () => void {
  peerSubscribers.add(listener);
  listener(getOfflineMeshKnownPeers());

  return () => {
    peerSubscribers.delete(listener);
  };
}

export function subscribeOfflineMeshPeerReady(
  listener: (readyPeers: string[]) => void,
): () => void {
  peerReadySubscribers.add(listener);
  listener(getReadyPeerIds());

  return () => {
    peerReadySubscribers.delete(listener);
  };
}

export function getOfflineMeshStatus() {
  return status;
}

export async function stopOfflineMesh(): Promise<void> {
  if (!protocol) {
    return;
  }

  deliveryWaiters.forEach(waiter => {
    clearTimeout(waiter.timeout);
    waiter.reject(new Error('Offline mesh stopped'));
  });
  deliveryWaiters.clear();

  await protocol.stop();
  await protocol.destroy();

  protocol = null;
  currentUserId = null;
  status = 'stopped';

  discoveredPeers.clear();
  linkReadyPeers.clear();
  secureSessionPeers.clear();
  pendingMessages.clear();
  notifyPeerSubscribers();
  notifyPeerReadySubscribers();

  console.log('Offline mesh stopped');
}
