type OfflineMessageSavedEvent = {
    localConversationId: number;
    participantKey: string;
    senderClerkUserId: string;
    recipientClerkUserId: string;
    body: string;
  };
  
  type Listener = (event: OfflineMessageSavedEvent) => void | Promise<void>;
  
  const listeners = new Set<Listener>();
  
  export function emitOfflineMessageSaved(event: OfflineMessageSavedEvent) {
    for (const listener of listeners) {
      void listener(event);
    }
  }
  
  export function subscribeToOfflineMessageSaved(listener: Listener) {
    listeners.add(listener);
  
    return () => {
      listeners.delete(listener);
    };
  }