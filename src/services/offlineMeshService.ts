import { OfflineProtocol, MessagePriority } from '@offline-protocol/mesh-sdk';
import { requestOfflineMeshPermissions } from './offlinePermissions';

let protocol: OfflineProtocol | null = null;
let currentUserId: string | null = null;

let status: 'idle' | 'starting' | 'running' | 'stopped' | 'permission_denied' =
  'idle';

const discoveredPeers = new Map<string, number>();
const pendingMessages = new Map<
  string,
  {
    recipient: string;
    content: string;
  }
>();

const peerSubscribers = new Set<(peers: string[]) => void>();

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

function notifyPeerSubscribers() {
  const peers = getOfflineMeshKnownPeers();

  peerSubscribers.forEach(listener => {
    listener(peers);
  });
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

function registerOfflineMeshListeners(activeProtocol: OfflineProtocol) {
  activeProtocol.on('neighbor_discovered', (event: any) => {
    console.log(`[PEER FOUND] ${event.peer_id} via ${event.transport}, RSSI: ${event.rssi}`);
    discoveredPeers.set(event.peer_id, event.rssi ?? -100);
    notifyPeerSubscribers();
  });

  activeProtocol.on('neighbor_lost', (event: any) => {
    console.log(`[PEER LOST] ${event.peer_id}`);
    discoveredPeers.delete(event.peer_id);
    notifyPeerSubscribers();
  });

  activeProtocol.on('message_sent', (event: any) => {
    console.log(`[SENT] Message ${event.message_id} to ${event.recipient}`);

    pendingMessages.set(event.message_id, {
      recipient: event.recipient,
      content: event.content,
    });
  });

  activeProtocol.on('message_delivered', (event: any) => {
    console.log(
      `[DELIVERED] Message ${event.message_id} in ${event.latency_ms}ms, ${event.hop_count} hops`,
    );

    pendingMessages.delete(event.message_id);
  });

  activeProtocol.on('message_failed', (event: any) => {
    console.log(
      `[FAILED] Message ${event.message_id}: ${event.reason} (${event.retry_count} retries)`,
    );

    pendingMessages.delete(event.message_id);
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
  });

  activeProtocol.on('transport_switched', (event: any) => {
    console.log(
      `[TRANSPORT] Switched from ${event.from} to ${event.to}: ${event.reason}`,
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

  activeProtocol.on('presence_updated', (event: any) => {
    console.log(`[PRESENCE] ${event.peer_id} is now ${event.status}`);
  });

  activeProtocol.on('typing_indicator_received', (event: any) => {
    console.log(
      `[TYPING] ${event.sender} is ${
        event.is_typing ? 'typing' : 'idle'
      }`,
    );
  });

  activeProtocol.on('group_message_received', (event: any) => {
    console.log(
      `[GROUP] ${event.sender} in ${event.group_id}: ${event.content}`,
    );
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
      ble: { enabled: true },

      internet: {
        enabled: false,
      },

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
  });

  registerOfflineMeshListeners(protocol);

  await protocol.start();

  status = 'running';

  console.log('Offline mesh started for:', clerkUserId);
}

export async function sendOfflineMeshMessage(params: {
  recipientId: string;
  content: string;
}): Promise<string> {
  if (!protocol || status !== 'running') {
    throw new Error('Offline mesh is not running.');
  }

  const messageId = await protocol.sendMessage({
    recipient: params.recipientId,
    content: params.content,
    priority: MessagePriority.High,
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

  if (!recipientId) {
    throw new Error('Missing recipientId for offline chat message.');
  }

  if (!body) {
    throw new Error('Missing body/content for offline chat message.');
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

  return sendOfflineMeshMessage({
    recipientId,
    content: JSON.stringify(payload),
  });
}

export async function sendOfflineDebugPing(
  recipientId: string,
): Promise<string> {
  return sendOfflineMeshMessage({
    recipientId,
    content: `DEBUG_PING:${new Date().toISOString()}`,
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
    const timeout = setTimeout(() => resolve(false), timeoutMs);

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

export function hasOfflineMeshPeer(peerId: string): boolean {
  return discoveredPeers.has(peerId);
}

export function getOfflineMeshKnownPeers(): string[] {
  return Array.from(discoveredPeers.keys());
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

export function getOfflineMeshStatus() {
  return status;
}

export async function stopOfflineMesh(): Promise<void> {
  if (!protocol) {
    return;
  }

  await protocol.stop();
  await protocol.destroy();

  protocol = null;
  currentUserId = null;
  status = 'stopped';

  discoveredPeers.clear();
  pendingMessages.clear();
  notifyPeerSubscribers();

  console.log('Offline mesh stopped');
}