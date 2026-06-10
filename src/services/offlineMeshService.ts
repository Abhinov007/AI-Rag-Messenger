import { OfflineProtocol } from '@offline-protocol/mesh-sdk';

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
  | ((payload: IncomingOfflineChatPayload, rawEvent: MeshEventPayload) => Promise<void>)
  | null = null;

export function getOfflineMeshStatus(): OfflineMeshStatus {
  return status;
}

export function setOfflineMeshIncomingMessageHandler(
  handler: (payload: IncomingOfflineChatPayload, rawEvent: MeshEventPayload) => Promise<void>,
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

    console.log('[OFFLINE INCOMING CONTENT CANDIDATES]', {
      eventName,
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

function registerOfflineMeshEvents(mesh: OfflineProtocolInstance) {
  const meshAny = mesh as unknown as {
    on: (
      eventName: string,
      handler: (event: MeshEventPayload) => void | Promise<void>,
    ) => void;
  };

  meshAny.on('neighbor_discovered', event => {
    console.log('[OFFLINE PEER FOUND]', {
      peerId: getEventString(event, 'peer_id'),
      transport: getEventString(event, 'transport'),
      rssi: getEventNumber(event, 'rssi'),
      raw: event,
    });
  });

  meshAny.on('neighbor_lost', event => {
    console.log('[OFFLINE PEER LOST]', {
      peerId: getEventString(event, 'peer_id'),
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

  meshAny.on('message_sent', event => {
    console.log('[OFFLINE MESSAGE SENT]', {
      messageId: getEventString(event, 'message_id'),
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

  /**
   * The SDK docs mention message_received, but your logs show BLE delivery
   * without this listener firing. So we listen to multiple possible JS bridge
   * names to confirm which one the native layer emits.
   */
  meshAny.on('message_received', event => {
    void handlePossibleIncomingMessage('message_received', event);
  });

  meshAny.on('message', event => {
    void handlePossibleIncomingMessage('message', event);
  });

  meshAny.on('messageReceived', event => {
    void handlePossibleIncomingMessage('messageReceived', event);
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
    await protocol.start();

    status = 'running';

    console.log('Offline Mesh core started. Waiting for BLE peer discovery:', {
      clerkUserId,
    });
  } catch (error) {
    status = 'error';
    protocol = null;
    currentUserId = null;

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
    bodyLength: body.length,
  });

  if (!protocol || status !== 'running') {
    console.warn('Offline mesh send skipped: protocol not running', {
      status,
      hasProtocol: Boolean(protocol),
    });
    return null;
  }

  const payload: IncomingOfflineChatPayload = {
    type: 'airag.message.v1',
    clientMessageId: String(localMessageId),
    senderClerkUserId,
    recipientClerkUserId,
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
    status = 'stopped';
    currentUserId = null;
    return;
  }

  try {
    await protocol.stop();
    await protocol.destroy();
  } finally {
    protocol = null;
    currentUserId = null;
    status = 'stopped';
  }
}