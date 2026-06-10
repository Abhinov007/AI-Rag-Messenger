import {
  MessagePriority,
  OfflineProtocol,
} from '@offline-protocol/mesh-sdk';

import { requestOfflineMeshPermissions } from './offlinePermissions';

type OfflineProtocolInstance = InstanceType<typeof OfflineProtocol>;

export type IncomingOfflineChatPayload = {
  type: 'airag.message.v1';
  clientMessageId: string;
  senderClerkUserId: string;
  recipientClerkUserId: string;
  conversationId?: number;
  participantKey?: string | null;
  body: string;
  createdAt: string;
};

type OfflineDebugPingPayload = {
  type: 'airag.debug.ping.v1';
  body: 'ping';
  createdAt: string;
};

type OfflineWirePayload = IncomingOfflineChatPayload | OfflineDebugPingPayload;

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
  console.log('[OFFLINE RAW MESSAGE RECEIVED]', {
    eventName,
    event,
  });

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
      console.warn('[OFFLINE RECEIVE SKIPPED] no readable content', {
        eventName,
        event,
      });
      return;
    }

    const parsed = JSON.parse(rawContent) as OfflineWirePayload;

    console.log('[OFFLINE MESSAGE PARSED]', parsed);

    if (parsed.type === 'airag.debug.ping.v1') {
      console.log('[OFFLINE DEBUG PING RECEIVED]', parsed);
      return;
    }

    if (parsed.type !== 'airag.message.v1') {
      console.warn('[OFFLINE RECEIVE SKIPPED] unknown message type', parsed);
      return;
    }

    if (!incomingMessageHandler) {
      console.warn('[OFFLINE RECEIVE SKIPPED] message handler not registered');
      return;
    }

    await incomingMessageHandler(parsed, event);

    console.log('[OFFLINE MESSAGE HANDLER COMPLETED]', {
      clientMessageId: parsed.clientMessageId,
      senderClerkUserId: parsed.senderClerkUserId,
      recipientClerkUserId: parsed.recipientClerkUserId,
    });
  } catch (error) {
    console.error('[OFFLINE RECEIVE HANDLER FAILED]', error);
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
    console.warn('[OFFLINE MESSAGE FAILED event]', {
      messageId: getEventString(event, 'message_id'),
      reason: getEventString(event, 'reason'),
      retryCount: getEventNumber(event, 'retry_count'),
      recipient: getEventString(event, 'recipient'),
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
   * Extra defensive listeners while debugging.
   */
  meshAny.on('messageReceived', event => {
    void handlePossibleIncomingMessage('messageReceived', event);
  });

  meshAny.on('MessageReceived', event => {
    void handlePossibleIncomingMessage('MessageReceived', event);
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
  discoveredPeerIds.clear();
  notifyPeerChangeListeners();

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
        defaultTimeoutMs: 15000,
        maxPendingAcks: 1000,
      },
      retry: {
        maxRetries: 3,
        initialDelayMs: 3000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        outboxMaxLifetimeMs: 3600000,
      },
      dedup: {
        maxTrackedMessages: 10000,
        retentionTimeSecs: 3600,
      },
    },
  } as any);

  registerOfflineMeshEvents(protocol);
  await ensureBluetoothReady(protocol);

  try {
    await protocol.start();
    status = 'running';

    console.log('Offline Mesh core started. Waiting for BLE peer discovery:', {
      clerkUserId,
    });
  } catch (error) {
    status = 'error';
    protocol = null;
    currentUserId = null;

    throw error;
  }
}

export async function stopOfflineMesh(): Promise<void> {
  const mesh = protocol;

  protocol = null;
  currentUserId = null;
  status = 'stopped';
  discoveredPeerIds.clear();
  notifyPeerChangeListeners();

  if (!mesh) {
    return;
  }

  const meshAny = mesh as unknown as {
    stop?: () => Promise<void>;
    destroy?: () => Promise<void>;
  };

  try {
    if (meshAny.stop) {
      await meshAny.stop();
    }

    if (meshAny.destroy) {
      await meshAny.destroy();
    }
  } catch (error) {
    console.warn('Failed to stop Offline Mesh cleanly:', error);
  }
}

export async function sendOfflineDebugPing(
  recipientClerkUserId: string,
): Promise<string> {
  console.log('[OFFLINE DEBUG PING START]', {
    status,
    hasProtocol: Boolean(protocol),
    recipientClerkUserId,
    knownPeers: Array.from(discoveredPeerIds),
  });

  if (!protocol) {
    console.warn('[OFFLINE DEBUG PING BLOCKED] protocol is null', {
      status,
      knownPeers: Array.from(discoveredPeerIds),
    });

    throw new Error('Offline protocol is null');
  }

  if (status !== 'running') {
    console.warn('[OFFLINE DEBUG PING BLOCKED] protocol not running', {
      status,
      knownPeers: Array.from(discoveredPeerIds),
    });

    throw new Error(`Offline protocol is not running. Current status: ${status}`);
  }

  if (!discoveredPeerIds.has(recipientClerkUserId)) {
    console.warn('[OFFLINE DEBUG PING WARNING] recipient not discovered yet', {
      recipientClerkUserId,
      knownPeers: Array.from(discoveredPeerIds),
    });
  }

  const content = JSON.stringify({
    type: 'airag.debug.ping.v1',
    body: 'ping',
    createdAt: new Date().toISOString(),
  });

  console.log('[OFFLINE DEBUG PING BEFORE protocol.sendMessage]', {
    recipientClerkUserId,
    content,
  });

  const sendPromise = protocol.sendMessage({
    recipient: recipientClerkUserId,
    content,
    priority: MessagePriority.High,
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('debug ping sendMessage timed out after 10 seconds'));
    }, 10000);
  });

  const messageId = await Promise.race([sendPromise, timeoutPromise]);

  console.log('[OFFLINE DEBUG PING QUEUED]', {
    messageId,
    recipientClerkUserId,
  });

  return String(messageId);
}

export async function sendOfflineChatMessage(input: {
  recipientClerkUserId: string;
  senderClerkUserId: string;
  localMessageId: number;
  conversationId: number;
  participantKey: string | null;
  body: string;
}): Promise<string> {
  const {
    recipientClerkUserId,
    senderClerkUserId,
    localMessageId,
    conversationId,
    participantKey,
    body,
  } = input;

  console.log('[OFFLINE SERVICE ENTERED sendOfflineChatMessage]', input);

  console.log('[OFFLINE SERVICE STATE BEFORE SEND]', {
    status,
    hasProtocol: Boolean(protocol),
    senderClerkUserId,
    recipientClerkUserId,
    localMessageId,
    conversationId,
    knownPeers: Array.from(discoveredPeerIds),
    bodyLength: body.length,
  });

  if (!protocol) {
    console.warn('[OFFLINE SERVICE BLOCKED] protocol is null', {
      status,
      knownPeers: Array.from(discoveredPeerIds),
    });

    throw new Error('Offline protocol is null');
  }

  if (status !== 'running') {
    console.warn('[OFFLINE SERVICE BLOCKED] protocol not running', {
      status,
      knownPeers: Array.from(discoveredPeerIds),
    });

    throw new Error(`Offline protocol is not running. Current status: ${status}`);
  }

  if (!discoveredPeerIds.has(recipientClerkUserId)) {
    console.warn('[OFFLINE SERVICE WARNING] recipient not discovered yet', {
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

  console.log('[OFFLINE SERVICE PAYLOAD READY]', {
    chars: content.length,
    content,
  });

  console.log('[OFFLINE SERVICE BEFORE protocol.sendMessage]', {
    recipient: recipientClerkUserId,
  });

  const sendPromise = protocol.sendMessage({
    recipient: recipientClerkUserId,
    content,
    priority: MessagePriority.High,
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`chat sendMessage timed out after 10 seconds for recipient ${recipientClerkUserId}`));
    }, 10000);
  });

  const messageId = await Promise.race([sendPromise, timeoutPromise]);

  console.log('[OFFLINE SERVICE AFTER protocol.sendMessage]', {
    localMessageId,
    meshMessageId: messageId,
    recipientClerkUserId,
  });

  return String(messageId);
}