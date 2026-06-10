import {
  MessagePriority,
  OfflineProtocol,
} from '@offline-protocol/mesh-sdk';

import { requestOfflineMeshPermissions } from './offlinePermissions';

type OfflineProtocolInstance = InstanceType<typeof OfflineProtocol>;

type IncomingOfflineChatPayload = {
  type: 'airag.message.v1';
  clientMessageId: string;
  senderClerkUserId: string;
  recipientClerkUserId: string;
  conversationId?: number;
  participantKey?: string | null;
  body: string;
  createdAt: string;
};

type OfflineMeshStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'permission_denied'
  | 'error';

type MeshEventPayload = Record<string, unknown>;

let protocol: OfflineProtocolInstance | null = null;
let currentUserId: string | null = null;
let status: OfflineMeshStatus = 'stopped';

let incomingMessageHandler:
  | ((
      payload: IncomingOfflineChatPayload,
      rawEvent: MeshEventPayload,
    ) => Promise<void>)
  | null = null;

const processedIncomingEventKeys = new Set<string>();
const discoveredPeerIds = new Set<string>();
const peerChangeListeners = new Set<() => void>();

function notifyPeerChangeListeners() {
  for (const listener of peerChangeListeners) {
    listener();
  }
}

export function getOfflineMeshStatus(): OfflineMeshStatus {
  return status;
}

export function getOfflineMeshKnownPeers(): string[] {
  return Array.from(discoveredPeerIds);
}

export function subscribeOfflineMeshPeers(listener: () => void): () => void {
  peerChangeListeners.add(listener);

  return () => {
    peerChangeListeners.delete(listener);
  };
}

export function hasOfflineMeshPeer(peerId: string): boolean {
  return discoveredPeerIds.has(peerId);
}

export async function waitForOfflineMeshPeer(
  peerId: string,
  timeoutMs = 30000,
): Promise<boolean> {
  if (discoveredPeerIds.has(peerId)) {
    return true;
  }

  const startedAt = Date.now();

  return new Promise(resolve => {
    const interval = setInterval(() => {
      if (discoveredPeerIds.has(peerId)) {
        clearInterval(interval);
        resolve(true);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 500);
  });
}

export function setOfflineMeshIncomingMessageHandler(
  handler: (
    payload: IncomingOfflineChatPayload,
    rawEvent: MeshEventPayload,
  ) => Promise<void>,
) {
  console.log('Offline mesh incoming message handler registered');
  incomingMessageHandler = handler;
}

function getEventString(
  event: MeshEventPayload,
  key: string,
): string | null {
  const value = event[key];

  return typeof value === 'string' ? value : null;
}

function getEventNumber(
  event: MeshEventPayload,
  key: string,
): number | null {
  const value = event[key];

  return typeof value === 'number' ? value : null;
}

function getIncomingEventDedupeKey(
  event: MeshEventPayload,
  rawContent: string | null,
): string {
  const messageId =
    getEventString(event, 'message_id') ??
    getEventString(event, 'messageId') ??
    getEventString(event, 'id') ??
    'no-message-id';

  return `${messageId}:${rawContent ?? 'no-content'}`;
}

function getPossibleRawContent(event: MeshEventPayload): string | null {
  const candidates = [
    event.content,
    event.message,
    event.payload,
    event.data,
    event.body,
    event.rawContent,
    event.raw_content,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }

    if (
      candidate &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate)
    ) {
      try {
        return JSON.stringify(candidate);
      } catch {
        // Ignore non-serializable candidate.
      }
    }
  }

  return null;
}

async function handlePossibleIncomingMessage(
  eventName: string,
  event: MeshEventPayload,
) {
  console.log(`[OFFLINE INCOMING EVENT: ${eventName}]`, event);

  try {
    const rawContent = getPossibleRawContent(event);
    const dedupeKey = getIncomingEventDedupeKey(event, rawContent);

    if (processedIncomingEventKeys.has(dedupeKey)) {
      console.log('[OFFLINE INCOMING EVENT DUPLICATE SKIPPED]', {
        eventName,
        dedupeKey,
      });
      return;
    }

    processedIncomingEventKeys.add(dedupeKey);

    if (processedIncomingEventKeys.size > 500) {
      processedIncomingEventKeys.clear();
    }

    console.log('[OFFLINE INCOMING CONTENT CANDIDATES]', {
      eventName,
      type: event.type,
      content: event.content,
      message: event.message,
      payload: event.payload,
      data: event.data,
      body: event.body,
      rawContent: event.rawContent,
      raw_content: event.raw_content,
      sender: getEventString(event, 'sender'),
      sender_id: getEventString(event, 'sender_id'),
      recipient: getEventString(event, 'recipient'),
      recipient_id: getEventString(event, 'recipient_id'),
      message_id: getEventString(event, 'message_id'),
    });

    if (!rawContent) {
      console.warn('Offline incoming event had no readable content:', {
        eventName,
        event,
      });
      return;
    }

    const parsed = JSON.parse(rawContent) as IncomingOfflineChatPayload;

    console.log('[OFFLINE MESSAGE PARSED]', parsed);

    if (parsed.type !== 'airag.message.v1') {
      console.warn('Ignoring unknown offline message type:', parsed.type);
      return;
    }

    if (!incomingMessageHandler) {
      console.warn('Offline message handler not registered yet.');
      return;
    }

    await incomingMessageHandler(parsed, event);

    console.log('[OFFLINE MESSAGE HANDLER COMPLETED]', {
      clientMessageId: parsed.clientMessageId,
      senderClerkUserId: parsed.senderClerkUserId,
      recipientClerkUserId: parsed.recipientClerkUserId,
    });
  } catch (error) {
    console.error('Failed to process offline incoming event:', error);
  }
}

async function ensureBluetoothReady(mesh: OfflineProtocolInstance) {
  const meshAny = mesh as unknown as {
    isBluetoothEnabled?: () => Promise<boolean>;
    requestEnableBluetooth?: () => Promise<boolean>;
  };

  if (!meshAny.isBluetoothEnabled) {
    return;
  }

  const enabled = await meshAny.isBluetoothEnabled();

  if (enabled) {
    return;
  }

  if (meshAny.requestEnableBluetooth) {
    const prompted = await meshAny.requestEnableBluetooth();

    if (!prompted) {
      throw new Error('Bluetooth must be enabled for offline mesh messaging.');
    }
  }
}

function registerOfflineMeshEvents(mesh: OfflineProtocolInstance) {
  const meshAny = mesh as unknown as {
    on: (
      eventName: string,
      handler: (event: MeshEventPayload) => void | Promise<void>,
    ) => void;
  };

  meshAny.on('all', event => {
    console.log('[OFFLINE EVENT ALL]', {
      type: event?.type,
      event,
    });
  });

  meshAny.on('neighbor_discovered', event => {
    const peerId = getEventString(event, 'peer_id');

    if (peerId) {
      discoveredPeerIds.add(peerId);
      notifyPeerChangeListeners();
    }

    console.log('[OFFLINE PEER FOUND]', {
      peerId,
      knownPeers: Array.from(discoveredPeerIds),
      transport: getEventString(event, 'transport'),
      rssi: getEventNumber(event, 'rssi'),
      raw: event,
    });
  });

  meshAny.on('neighbor_lost', event => {
    const peerId = getEventString(event, 'peer_id');

    if (peerId) {
      discoveredPeerIds.delete(peerId);
      notifyPeerChangeListeners();
    }

    console.log('[OFFLINE PEER LOST]', {
      peerId,
      knownPeers: Array.from(discoveredPeerIds),
      raw: event,
    });
  });

  meshAny.on('secure_session_established', event => {
    console.log('[OFFLINE SECURE SESSION]', {
      peerId: getEventString(event, 'peer_id'),
      groupId: getEventString(event, 'group_id'),
      raw: event,
    });
  });

  meshAny.on('secure_session_failed', event => {
    console.log('[OFFLINE SECURE SESSION FAILED]', {
      peerId: getEventString(event, 'peer_id'),
      reason: getEventString(event, 'reason'),
      raw: event,
    });
  });

  meshAny.on('message_sent', event => {
    console.log('[OFFLINE MESSAGE SENT]', {
      messageId: getEventString(event, 'message_id'),
      sender: getEventString(event, 'sender'),
      recipient: getEventString(event, 'recipient'),
      raw: event,
    });
  });

  meshAny.on('message_delivered', event => {
    console.log('[OFFLINE MESSAGE DELIVERED]', {
      messageId: getEventString(event, 'message_id'),
      latencyMs: getEventNumber(event, 'latency_ms'),
      hopCount: getEventNumber(event, 'hop_count'),
      transport: getEventString(event, 'transport'),
      raw: event,
    });
  });

  meshAny.on('message_failed', event => {
    console.log('[OFFLINE MESSAGE FAILED]', {
      messageId: getEventString(event, 'message_id'),
      reason: getEventString(event, 'reason'),
      retryCount: getEventNumber(event, 'retry_count'),
      raw: event,
    });
  });

  meshAny.on('message_deferred', event => {
    console.warn('[OFFLINE MESSAGE DEFERRED]', {
      messageId: getEventString(event, 'message_id'),
      reason: getEventString(event, 'reason'),
      retryCount: getEventNumber(event, 'retry_count'),
      nextRetryAt: getEventNumber(event, 'next_retry_at'),
      raw: event,
    });
  });

  meshAny.on('message_received', event => {
    void handlePossibleIncomingMessage('message_received', event);
  });

  meshAny.on('group_message_received', event => {
    void handlePossibleIncomingMessage('group_message_received', event);
  });

  /*
   * Defensive listeners while debugging.
   * These should normally not fire if SDK follows documented snake_case events.
   */
  meshAny.on('messageReceived', event => {
    void handlePossibleIncomingMessage('messageReceived', event);
  });

  meshAny.on('MessageReceived', event => {
    void handlePossibleIncomingMessage('MessageReceived', event);
  });

  meshAny.on('groupMessageReceived', event => {
    void handlePossibleIncomingMessage('groupMessageReceived', event);
  });

  meshAny.on('GroupMessageReceived', event => {
    void handlePossibleIncomingMessage('GroupMessageReceived', event);
  });

  meshAny.on('data_received', event => {
    void handlePossibleIncomingMessage('data_received', event);
  });

  meshAny.on('dataReceived', event => {
    void handlePossibleIncomingMessage('dataReceived', event);
  });

  meshAny.on('payload_received', event => {
    void handlePossibleIncomingMessage('payload_received', event);
  });

  meshAny.on('payloadReceived', event => {
    void handlePossibleIncomingMessage('payloadReceived', event);
  });

  meshAny.on('service_message', event => {
    void handlePossibleIncomingMessage('service_message', event);
  });

  meshAny.on('serviceMessage', event => {
    void handlePossibleIncomingMessage('serviceMessage', event);
  });

  meshAny.on('transport_switched', event => {
    console.log('[OFFLINE TRANSPORT SWITCHED]', {
      from: getEventString(event, 'from'),
      to: getEventString(event, 'to'),
      reason: getEventString(event, 'reason'),
      raw: event,
    });
  });

  meshAny.on('diagnostic', event => {
    console.log('[OFFLINE DIAGNOSTIC]', {
      level: getEventString(event, 'level'),
      message: getEventString(event, 'message'),
      context: event.context,
      raw: event,
    });
  });
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
      ble: {
        enabled: true,
      },

      internet: {
        enabled: false,
      },

      wifiDirect: {
        enabled: false,
      },
    },

    encryption: {
      enabled: false,
      autoKeyExchange: false,
      storePending: false,
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

    network: {
      initialTtl: 8,
    },

    reliability: {
      ack: {
        defaultTimeoutMs: 5000,
        maxPendingAcks: 1000,
      },
      retry: {
        maxRetries: 5,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        outboxMaxLifetimeMs: 3600000,
      },
      dedup: {
        maxTrackedMessages: 10000,
        retentionTimeSecs: 3600,
      },
    },
  });

  registerOfflineMeshEvents(protocol);

  try {
    await ensureBluetoothReady(protocol);

    await protocol.start();

    status = 'running';

    console.log('Offline Mesh core started. Waiting for BLE peer discovery:', {
      clerkUserId,
    });
  } catch (error) {
    status = 'error';
    protocol = null;
    currentUserId = null;
    discoveredPeerIds.clear();
    notifyPeerChangeListeners();

    console.error('Failed to start Offline Mesh:', error);

    throw error;
  }
}

export async function sendOfflineChatMessage(input: {
  recipientClerkUserId: string;
  senderClerkUserId: string;
  localMessageId: number;
  conversationId: number;
  participantKey: string | null;
  body: string;
}): Promise<string | null> {
  const {
    recipientClerkUserId,
    senderClerkUserId,
    localMessageId,
    conversationId,
    participantKey,
    body,
  } = input;

  console.log('Trying offline mesh send:', {
    status,
    hasProtocol: Boolean(protocol),
    senderClerkUserId,
    recipientClerkUserId,
    localMessageId,
    conversationId,
    knownPeers: Array.from(discoveredPeerIds),
    bodyLength: body.length,
  });

  if (!protocol || status !== 'running') {
    console.warn('Offline mesh send skipped: protocol not running', {
      status,
      hasProtocol: Boolean(protocol),
    });
    return null;
  }

  if (!discoveredPeerIds.has(recipientClerkUserId)) {
    console.warn('Offline mesh send warning: recipient is not in discovered peer set', {
      recipientClerkUserId,
      knownPeers: Array.from(discoveredPeerIds),
    });
  }

  const payload: IncomingOfflineChatPayload = {
    type: 'airag.message.v1',
    clientMessageId: String(localMessageId),
    senderClerkUserId,
    recipientClerkUserId,
    conversationId,
    participantKey,
    body,
    createdAt: new Date().toISOString(),
  };

  const content = JSON.stringify(payload);

  console.log('Offline payload size:', {
    chars: content.length,
    content,
  });

  const messageId = await protocol.sendMessage({
    recipient: recipientClerkUserId,
    content,
    priority: MessagePriority.High,
  });

  console.log('Offline message queued:', {
    localMessageId,
    meshMessageId: messageId,
    recipientClerkUserId,
  });

  return String(messageId);
}

export async function stopOfflineMesh(): Promise<void> {
  if (!protocol) {
    discoveredPeerIds.clear();
    notifyPeerChangeListeners();
    status = 'stopped';
    currentUserId = null;
    return;
  }

  try {
    await protocol.stop();
    await protocol.destroy();
  } finally {
    discoveredPeerIds.clear();
    notifyPeerChangeListeners();
    protocol = null;
    currentUserId = null;
    status = 'stopped';
  }
}

export async function logOfflineMeshDebugState(
  label: string,
  recipientClerkUserId?: string | null,
): Promise<void> {
  if (!protocol) {
    console.log('[OFFLINE DEBUG STATE]', {
      label,
      hasProtocol: false,
      status,
      recipientClerkUserId,
      knownPeers: Array.from(discoveredPeerIds),
    });
    return;
  }

  try {
    const meshAny = protocol as unknown as {
      getState?: () => Promise<unknown>;
      getActiveTransports?: () => Promise<unknown>;
      isBluetoothEnabled?: () => Promise<boolean>;
      getBLePeerCount?: () => Promise<number>;
      hasRoute?: (destination: string) => Promise<boolean>;
      getBestRoute?: (destination: string) => Promise<unknown>;
      getRetryQueueSize?: () => Promise<number>;
      getPendingAckCount?: () => Promise<number>;
    };

    const [
      protocolState,
      activeTransports,
      bluetoothEnabled,
      blePeerCount,
      hasRoute,
      bestRoute,
      retryQueueSize,
      pendingAckCount,
    ] = await Promise.all([
      meshAny.getState?.().catch(error => `getState failed: ${String(error)}`),
      meshAny
        .getActiveTransports?.()
        .catch(error => `getActiveTransports failed: ${String(error)}`),
      meshAny
        .isBluetoothEnabled?.()
        .catch(error => `isBluetoothEnabled failed: ${String(error)}`),
      meshAny
        .getBLePeerCount?.()
        .catch(error => `getBLePeerCount failed: ${String(error)}`),
      recipientClerkUserId
        ? meshAny
            .hasRoute?.(recipientClerkUserId)
            .catch(error => `hasRoute failed: ${String(error)}`)
        : Promise.resolve(null),
      recipientClerkUserId
        ? meshAny
            .getBestRoute?.(recipientClerkUserId)
            .catch(error => `getBestRoute failed: ${String(error)}`)
        : Promise.resolve(null),
      meshAny
        .getRetryQueueSize?.()
        .catch(error => `getRetryQueueSize failed: ${String(error)}`),
      meshAny
        .getPendingAckCount?.()
        .catch(error => `getPendingAckCount failed: ${String(error)}`),
    ]);

    console.log('[OFFLINE DEBUG STATE]', {
      label,
      status,
      recipientClerkUserId,
      knownPeers: Array.from(discoveredPeerIds),
      protocolState,
      activeTransports,
      bluetoothEnabled,
      blePeerCount,
      hasRoute,
      bestRoute,
      retryQueueSize,
      pendingAckCount,
    });
  } catch (error) {
    console.warn('[OFFLINE DEBUG STATE FAILED]', {
      label,
      recipientClerkUserId,
      error,
    });
  }
}