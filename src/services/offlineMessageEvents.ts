type OfflineMessageSavedEvent = {
    localConversationId: number;
    participantKey: string;
    senderClerkUserId: string;
    recipientClerkUserId: string;
    body: string;
  };
  
  type Listener = (event: OfflineMessageSavedEvent) => void | Promise<void>;
  
  const listeners = new Set<Listener>();
  
  /**
   * Emits an offline message saved event to all registered listeners.
   * @param event - The offline message event payload containing message and conversation details
   */
  export function emitOfflineMessageSaved(event: OfflineMessageSavedEvent) {
    for (const listener of listeners) {
      void listener(event);
    }
  }
  
  /**
   * Subscribes a listener to offline message saved events.
   * @param listener - Callback function to be called when a message is saved
   * @returns Unsubscribe function to remove the listener
   */
  export function subscribeToOfflineMessageSaved(listener: Listener) {
    listeners.add(listener);
  
    return () => {
      listeners.delete(listener);
    };
  }