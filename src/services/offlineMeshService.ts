import {
    OfflineProtocol,
    MessagePriority,
  } from '@offline-protocol/mesh-sdk';
  
  import { requestOfflineMeshPermissions } from './offlinePermissions';
  import { getUtcNowIsoTimestamp } from '../utils/timestamps';
  
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
  
  let protocol: OfflineProtocolInstance | null = null;
  let currentUserId: string | null = null;
  let status: OfflineMeshStatus = 'stopped';
  
  let incomingMessageHandler:
    | ((payload: IncomingOfflineChatPayload, rawEvent: any) => Promise<void>)
    | null = null;
  
  export function getOfflineMeshStatus(): OfflineMeshStatus {
    return status;
  }
  
  export function setOfflineMeshIncomingMessageHandler(
    handler: (payload: IncomingOfflineChatPayload, rawEvent: any) => Promise<void>,
  ) {
    incomingMessageHandler = handler;
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
  
        /**
         * Start with pure offline BLE first.
         * Later you can enable internet relay if you run your own relay server.
         */
        internet: {
          enabled: false,
        },
  
        /**
         * Enable later after BLE works.
         */
        wifiDirect: {
          enabled: false,
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
  
    await protocol.start();
  
    status = 'running';
  
    console.log('Offline Mesh started for user:', clerkUserId);
  }
  
  type MeshEventPayload = Record<string, unknown>;

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

  meshAny.on('message_received', async event => {
    console.log('[OFFLINE MESSAGE RECEIVED]', {
      messageId: getEventString(event, 'message_id'),
      sender: getEventString(event, 'sender'),
      recipient: getEventString(event, 'recipient'),
      hopCount: getEventNumber(event, 'hop_count'),
      transport: getEventString(event, 'transport'),
      raw: event,
    });

    try {
      const rawContent = getEventString(event, 'content');

      if (!rawContent) {
        console.warn('Offline message received without string content:', event);
        return;
      }

      const parsed = JSON.parse(rawContent) as IncomingOfflineChatPayload;

      if (parsed.type !== 'airag.message.v1') {
        console.warn('Ignoring unknown offline message type:', parsed.type);
        return;
      }

      await incomingMessageHandler?.(parsed, event);
    } catch (error) {
      console.error('Failed to process offline mesh message:', error);
    }
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
  
  export async function sendOfflineChatMessage({
    recipientClerkUserId,
    senderClerkUserId,
    localMessageId,
    conversationId,
    participantKey,
    body,
  }: {
    recipientClerkUserId: string;
    senderClerkUserId: string;
    localMessageId: number;
    conversationId: number;
    participantKey?: string | null;
    body: string;
  }): Promise<string | null> {
    if (!protocol || status !== 'running') {
      console.warn('Offline Mesh is not running. Message remains local only.');
      return null;
    }
  
    const payload: IncomingOfflineChatPayload = {
      type: 'airag.message.v1',
      clientMessageId: String(localMessageId),
      senderClerkUserId,
      recipientClerkUserId,
      conversationId,
      participantKey: participantKey ?? null,
      body,
      createdAt: getUtcNowIsoTimestamp(),
    };
  
    const meshMessageId = await protocol.sendMessage({
      recipient: recipientClerkUserId,
      content: JSON.stringify(payload),
      priority: MessagePriority.High,
    });
  
    console.log('Offline message queued:', {
      localMessageId,
      meshMessageId,
      recipientClerkUserId,
    });
  
    return meshMessageId;
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