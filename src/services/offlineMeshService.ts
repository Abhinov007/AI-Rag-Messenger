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

type OfflineMeshEventEmitter = {
  on: (
    eventName: string,
    handler: (event: MeshEventPayload) => void | Promise<void>,
  ) => void;
};

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

let receivePollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Notifies all registered listeners of changes to discovered peers.
 */
function notifyPeerChangeListeners() {
  for (const listener of peerChangeListeners) {
    listener();
  }
}

/**
 * Gets the current status of the offline mesh protocol.
 * @returns The current offline mesh status ('stopped', 'starting', 'running', 'permission_denied', or 'error')
 */
export function getOfflineMeshStatus(): OfflineMeshStatus {
  return status;
}

/**
 * Gets the list of all discovered peer IDs in the mesh network.
 * @returns Array of discovered peer IDs
 */
export function getOfflineMeshKnownPeers(): string[] {
  return Array.from(discoveredPeerIds);
}

/**
 * Subscribes a listener to be notified when peers are discovered or lost.
 * @param listener - Callback function to be called when peer list changes
 * @returns Unsubscribe function to remove the listener
 */
export function subscribeOfflineMeshPeers(listener: () => void): () => void {
  peerChangeListeners.add(listener);

  return () => {
    peerChangeListeners.delete(listener);
  };
}

/**
 * Checks if a specific peer is currently known/discovered in the mesh network.
 * @param peerId - The ID of the peer to check
 * @returns True if the peer is known, false otherwise
 */
export function hasOfflineMeshPeer(peerId: string): boolean {
  return discoveredPeerIds.has(peerId);
}

/**
 * Waits for a specific peer to be discovered in the mesh network, with optional timeout.
 * @param peerId - The ID of the peer to wait for
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 30000)
 * @returns Promise that resolves to true if peer is found, false if timeout occurs
 */
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

/**
 * Sets or clears the handler function for incoming mesh messages.
 * @param handler - Handler function to process incoming messages, or null to clear the handler
 */
export function setOfflineMeshIncomingMessageHandler(
  handler:
    | ((
        payload: IncomingOfflineChatPayload,
        rawEvent: MeshEventPayload,
      ) => Promise<void>)
    | null,
) {
  if (handler) {
    console.log('Offline mesh incoming message handler registered');
  } else {
    console.log('Offline mesh incoming message handler cleared');
  }

  incomingMessageHandler = handler;
}

/**
 * Extracts a string value from an event object by key.
 * @param event - The event object
 * @param key - The property key to extract
 * @returns The string value if present, null otherwise
 */
function getEventString(
  event: MeshEventPayload,
  key: string,
): string | null {
  const value = event[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Extracts a numeric value from an event object by key.
 * @param event - The event object
 * @param key - The property key to extract
 * @returns The numeric value if present, null otherwise
 */
function getEventNumber(
  event: MeshEventPayload,
  key: string,
): number | null {
  const value = event[key];
  return typeof value === 'number' ? value : null;
}

/**
 * Extracts the peer ID from an event object by checking multiple possible key names.
 * @param event - The event object
 * @returns The peer ID if found, null otherwise
 */
function getPeerIdFromEvent(event: MeshEventPayload): string | null {
  return (
    getEventString(event, 'peer_id') ??
    getEventString(event, 'peerId') ??
    getEventString(event, 'peer') ??
    getEventString(event, 'id') ??
    getEventString(event, 'userId') ??
    null
  );
}

/**
 * Generates a deduplication key for an incoming event to prevent processing duplicates.
 * @param event - The event object
 * @param rawContent - The raw content of the message
 * @returns A unique string key combining message ID and content
 */
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

/**
 * Attempts to extract raw message content from an event by checking multiple possible fields.
 * @param event - The event object
 * @returns The raw content as a string if found, null otherwise
 */
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

/**
 * Processes incoming mesh events, deduplicates them, parses the payload, and invokes the registered handler.
 * @param eventName - The name of the event
 * @param event - The event payload
 */
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

/**
 * Ensures that Bluetooth is enabled, requesting user permission if necessary.
 * @param mesh - The offline protocol instance
 * @throws Error if Bluetooth must be enabled but is not available
 */
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

/**
 * Extracts a boolean value from an event object by key.
 * @param event - The event object
 * @param key - The property key to extract
 * @returns The boolean value if present, null otherwise
 */
function getEventBoolean(
  event: MeshEventPayload,
  key: string,
): boolean | null {
  const value = event[key];

  if (typeof value === 'boolean') {
    return value;
  }

  return null;
}

/**
 * Stops the interval-based polling for receiving messages.
 */
function stopOfflineReceivePolling() {
  if (receivePollTimer) {
    clearInterval(receivePollTimer);
    receivePollTimer = null;
  }
}

/**
 * Starts an interval-based polling mechanism to receive incoming messages from the protocol.
 * @param mesh - The offline protocol instance to poll for messages
 */
function startOfflineReceivePolling(mesh: OfflineProtocolInstance) {
  stopOfflineReceivePolling();

  const meshAny = mesh as unknown as {
    receiveMessage?: () => Promise<MeshEventPayload | null>;
  };

  if (!meshAny.receiveMessage) {
    console.log('[OFFLINE RECEIVE POLL SKIPPED] receiveMessage not available');
    return;
  }

  receivePollTimer = setInterval(() => {
    void (async () => {
      try {
        const event = await meshAny.receiveMessage?.();

        if (!event) {
          return;
        }

        console.log('[OFFLINE RECEIVE POLL HIT]', event);

        await handlePossibleIncomingMessage('receiveMessage_poll', event);
      } catch (error) {
        console.warn('[OFFLINE RECEIVE POLL FAILED]', error);
      }
    })();
  }, 1000);

  console.log('[OFFLINE RECEIVE POLL STARTED]');
}

/**
 * Runs diagnostic checks after the protocol has started, including transport selection and peer counts.
 * @param mesh - The offline protocol instance
 */
async function runOfflinePostStartDiagnostics(mesh: OfflineProtocolInstance) {
  const meshAny = mesh as unknown as {
    forceTransport?: (type: 'ble' | 'internet' | 'wifiDirect') => Promise<void>;
    getActiveTransports?: () => Promise<string[]>;
    getBLePeerCount?: () => Promise<number>;
    getBLEPeerCount?: () => Promise<number>;
    getState?: () => Promise<unknown>;
  };

  try {
    if (meshAny.forceTransport) {
      await meshAny.forceTransport('ble');
      console.log('[OFFLINE BLE FORCED]');
    }

    if (meshAny.getActiveTransports) {
      const activeTransports = await meshAny.getActiveTransports();
      console.log('[OFFLINE ACTIVE TRANSPORTS]', activeTransports);
    }

    if (meshAny.getBLePeerCount) {
      const blePeerCount = await meshAny.getBLePeerCount();
      console.log('[OFFLINE BLE PEER COUNT]', blePeerCount);
    } else if (meshAny.getBLEPeerCount) {
      const blePeerCount = await meshAny.getBLEPeerCount();
      console.log('[OFFLINE BLE PEER COUNT]', blePeerCount);
    }

    if (meshAny.getState) {
      const protocolState = await meshAny.getState();
      console.log('[OFFLINE PROTOCOL STATE]', protocolState);
    }
  } catch (error) {
    console.warn('[OFFLINE POST START DIAGNOSTICS FAILED]', error);
  }
}

/**
 * Logs diagnostic information about the mesh send status and transport metrics.
 * @param label - A label to identify the diagnostic point in the code
 */
async function logOfflineMeshSendDiagnostics(label: string) {
  if (!protocol) {
    console.log('[OFFLINE SEND DIAGNOSTICS SKIPPED] protocol missing', {
      label,
    });
    return;
  }

  const meshAny = protocol as unknown as {
    getPendingAckCount?: () => Promise<number>;
    getRetryQueueSize?: () => Promise<number>;
    getDeliverySuccessRate?: () => Promise<number>;
    getTransportMetrics?: (type: 'ble' | 'internet' | 'wifiDirect') => Promise<unknown>;
    getActiveTransports?: () => Promise<string[]>;
    getBLePeerCount?: () => Promise<number>;
    getBLEPeerCount?: () => Promise<number>;
  };

  try {
    const blePeerCountPromise = meshAny.getBLePeerCount
      ? meshAny.getBLePeerCount().catch(() => null)
      : meshAny.getBLEPeerCount
        ? meshAny.getBLEPeerCount().catch(() => null)
        : Promise.resolve(null);

    const [
      pendingAckCount,
      retryQueueSize,
      deliverySuccessRate,
      bleMetrics,
      activeTransports,
      blePeerCount,
    ] = await Promise.all([
      meshAny.getPendingAckCount?.().catch(() => null),
      meshAny.getRetryQueueSize?.().catch(() => null),
      meshAny.getDeliverySuccessRate?.().catch(() => null),
      meshAny.getTransportMetrics?.('ble').catch(() => null),
      meshAny.getActiveTransports?.().catch(() => null),
      blePeerCountPromise,
    ]);

    console.log('[OFFLINE SEND DIAGNOSTICS]', {
      label,
      pendingAckCount,
      retryQueueSize,
      deliverySuccessRate,
      bleMetrics,
      activeTransports,
      blePeerCount,
      knownPeers: Array.from(discoveredPeerIds),
    });
  } catch (error) {
    console.warn('[OFFLINE SEND DIAGNOSTICS FAILED]', {
      label,
      error,
    });
  }
}

/**
 * Registers event listeners for all mesh protocol events including peer discovery, message delivery, and diagnostics.
 * @param mesh - The offline protocol instance
 */
function registerOfflineMeshEvents(mesh: OfflineProtocolInstance) {
  const meshAny = mesh as unknown as {
    on?: (eventName: string, listener: (event: MeshEventPayload) => void) => void;
  };

  if (!meshAny.on) {
    console.warn('[OFFLINE EVENTS] protocol.on is not available');
    return;
  }

  meshAny.on('neighbor_discovered', event => {
    const peerId = getPeerIdFromEvent(event);

    if (!peerId) {
      console.warn('[OFFLINE PEER FOUND WITHOUT ID]', event);
      return;
    }

    discoveredPeerIds.add(peerId);
    notifyPeerChangeListeners();

    console.log('[OFFLINE PEER FOUND]', {
      peerId,
      transport: getEventString(event, 'transport'),
      rssi: getEventNumber(event, 'rssi'),
      knownPeers: Array.from(discoveredPeerIds),
      raw: event,
    });
  });

  meshAny.on('neighbor_lost', event => {
    const peerId = getPeerIdFromEvent(event);

    if (!peerId) {
      console.warn('[OFFLINE PEER LOST WITHOUT ID]', event);
      return;
    }

    discoveredPeerIds.delete(peerId);
    notifyPeerChangeListeners();

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
      priority: getEventString(event, 'priority'),
      requiresAck: getEventBoolean(event, 'requires_ack'),
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
    console.warn('[OFFLINE MESSAGE FAILED]', {
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
    void handlePossibleIncomingMessage('message_received_event', event);
  });

  meshAny.on('transport_switched', event => {
    console.log('[OFFLINE TRANSPORT SWITCHED]', {
      from: getEventString(event, 'from'),
      to: getEventString(event, 'to'),
      reason: getEventString(event, 'reason'),
      raw: event,
    });
  });

  meshAny.on('network_metrics', event => {
    console.log('[OFFLINE NETWORK METRICS]', {
      neighborCount: getEventNumber(event, 'neighbor_count'),
      relayCount: getEventNumber(event, 'relay_count'),
      deliveryRatio: getEventNumber(event, 'delivery_ratio'),
      avgLatencyMs: getEventNumber(event, 'avg_latency_ms'),
      raw: event,
    });
  });

  meshAny.on('dors_transport_selected', event => {
    console.log('[OFFLINE DORS TRANSPORT SELECTED]', {
      from: getEventString(event, 'from'),
      transport: getEventString(event, 'transport'),
      reasonCode: getEventString(event, 'reason_code'),
      score: getEventNumber(event, 'score'),
      raw: event,
    });
  });

  meshAny.on('dors_transport_switched', event => {
    console.log('[OFFLINE DORS TRANSPORT SWITCHED]', {
      from: getEventString(event, 'from'),
      to: getEventString(event, 'to'),
      reasonCode: getEventString(event, 'reason_code'),
      reasonDetail: getEventString(event, 'reason_detail'),
      raw: event,
    });
  });

  meshAny.on('dors_escalation_triggered', event => {
    console.log('[OFFLINE DORS ESCALATION TRIGGERED]', {
      phase: getEventString(event, 'phase'),
      from: getEventString(event, 'from'),
      to: getEventString(event, 'to'),
      reasonCode: getEventString(event, 'reason_code'),
      reasonDetail: getEventString(event, 'reason_detail'),
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

/**
 * Initializes and starts the offline mesh protocol for a user.
 * Requests Bluetooth permissions, configures the protocol, and starts peer discovery.
 * @param clerkUserId - The Clerk user ID to start the mesh with
 * @throws Error if Bluetooth permissions are denied or protocol startup fails
 */
export async function startOfflineMesh(clerkUserId: string): Promise<void> {
  if (protocol && currentUserId === clerkUserId && status === 'running') {
    console.log('[OFFLINE MESH START SKIPPED] already running', {
      clerkUserId,
    });
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
        maxPendingPerPeer: 8,
        maxPendingGlobal: 32,
        pendingTtlMs: 30000,
        overflowPolicy: 'drop_oldest',
      },
    },
  
    relay: {
      allowRelay: false,
      relayPriority: 'never',
    },
  
    network: {
      // Allow messages to hop through at least 2-3 peers for mesh resilience
      initialTtl: 3,
    },
  
    reliability: {
      ack: {
        // BLE ACKs can be slow; give more time before timeout
        defaultTimeoutMs: 10000,
        maxPendingAcks: 100,
      },
      retry: {
        // BLE is unreliable; allow multiple retries with exponential backoff
        maxRetries: 5,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2.0,
        outboxMaxLifetimeMs: 120000,
      },
      dedup: {
        maxTrackedMessages: 2000,
        retentionTimeSecs: 3600,
      },
    },
  
    path: {
      // Forward to multiple peers to improve delivery chances on unreliable BLE
      forwardToTopK: 2,
      maxCongestionLevel: 0.8,
    },
  } as any);

  registerOfflineMeshEvents(protocol);
  await ensureBluetoothReady(protocol);

  try {
    await protocol.start();
    status = 'running';

    startOfflineReceivePolling(protocol);
    await runOfflinePostStartDiagnostics(protocol);

    console.log('Offline Mesh core started. Waiting for BLE peer discovery:', {
      clerkUserId,
    });
  } catch (error) {
    stopOfflineReceivePolling();
    status = 'error';
    protocol = null;
    currentUserId = null;
    discoveredPeerIds.clear();
    notifyPeerChangeListeners();

    throw error;
  }
}

/**
 * Stops the offline mesh protocol and cleans up all resources.
 * Halts peer discovery, polling, and closes the protocol connection.
 */
export async function stopOfflineMesh(): Promise<void> {
  stopOfflineReceivePolling();

  const mesh = protocol;

  protocol = null;
  currentUserId = null;
  status = 'stopped';
  discoveredPeerIds.clear();
  processedIncomingEventKeys.clear();
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

/**
 * Sends a debug ping message to a peer over the offline mesh.
 * Validates protocol status and peer availability before sending.
 * @param recipientClerkUserId - The Clerk user ID of the recipient peer
 * @returns The message ID returned by the protocol
 * @throws Error if protocol is null, not running, or peer is not discovered
 */
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
    console.warn('[OFFLINE DEBUG PING BLOCKED] recipient not discovered yet', {
      recipientClerkUserId,
      knownPeers: Array.from(discoveredPeerIds),
    });

    throw new Error(
      `Recipient ${recipientClerkUserId} is not discovered over BLE yet.`,
    );
  }

  const content = JSON.stringify({
    type: 'airag.debug.ping.v1',
    body: 'ping',
    createdAt: new Date().toISOString(),
  } satisfies OfflineDebugPingPayload);

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

  await logOfflineMeshSendDiagnostics('after_debug_ping_send');

  console.log('[OFFLINE DEBUG PING QUEUED]', {
    messageId,
    recipientClerkUserId,
  });

  return String(messageId);
}

/**
 * Sends a plain text ping message to a peer over the offline mesh.
 * Validates protocol status and peer availability before sending.
 * @param recipientClerkUserId - The Clerk user ID of the recipient peer
 * @returns The message ID returned by the protocol
 * @throws Error if protocol is null, not running, or peer is not discovered
 */
export async function sendOfflinePlainTextPing(
  recipientClerkUserId: string,
): Promise<string> {
  console.log('[OFFLINE PLAIN PING START]', {
    status,
    hasProtocol: Boolean(protocol),
    recipientClerkUserId,
    knownPeers: Array.from(discoveredPeerIds),
  });

  if (!protocol) {
    throw new Error('Offline protocol is null');
  }

  if (status !== 'running') {
    throw new Error(`Offline protocol is not running. Current status: ${status}`);
  }

  if (!discoveredPeerIds.has(recipientClerkUserId)) {
    console.warn('[OFFLINE PLAIN PING BLOCKED] recipient not discovered yet', {
      recipientClerkUserId,
      knownPeers: Array.from(discoveredPeerIds),
    });

    throw new Error(
      `Recipient ${recipientClerkUserId} is not discovered over BLE yet.`,
    );
  }

  const content = 'ping';

  console.log('[OFFLINE PLAIN PING BEFORE protocol.sendMessage]', {
    recipientClerkUserId,
    content,
  });

  const messageId = await protocol.sendMessage({
    recipient: recipientClerkUserId,
    content,
    priority: MessagePriority.Low,
  });

  await logOfflineMeshSendDiagnostics('after_plain_ping_send');

  console.log('[OFFLINE PLAIN PING QUEUED]', {
    messageId,
    recipientClerkUserId,
  });

  return String(messageId);
}

/**
 * Sends a chat message to a peer over the offline mesh with conversation context.
 * Validates protocol status and peer availability, then serializes and sends the message.
 * @param input - Object containing recipient ID, sender ID, message content, and conversation metadata
 * @returns The message ID returned by the protocol
 * @throws Error if protocol is null, not running, or peer is not discovered
 */
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
    console.warn('[OFFLINE SERVICE BLOCKED] recipient not discovered yet', {
      recipientClerkUserId,
      knownPeers: Array.from(discoveredPeerIds),
    });

    throw new Error(
      `Recipient ${recipientClerkUserId} is not discovered over BLE yet.`,
    );
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
      reject(
        new Error(
          `chat sendMessage timed out after 10 seconds for recipient ${recipientClerkUserId}`,
        ),
      );
    }, 10000);
  });

  const messageId = await Promise.race([sendPromise, timeoutPromise]);

  await logOfflineMeshSendDiagnostics('after_chat_message_send');

  console.log('[OFFLINE SERVICE AFTER protocol.sendMessage]', {
    localMessageId,
    meshMessageId: messageId,
    recipientClerkUserId,
  });

  return String(messageId);
}

