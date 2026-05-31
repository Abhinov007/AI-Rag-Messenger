/**
 * Single-conversation thread: loads messages from SQLite, supports sending,
 * pulls remote messages, subscribes to realtime Supabase inserts,
 * supports pull-to-refresh, retries sync, shows message sync status,
 * and keeps the composer above the keyboard.
 */
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '@clerk/expo';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  suggestRepliesForRecentMessages,
  summarizeRecentMessages,
} from '../ai/localLlamaAssistant';
import { getConversationById } from '../db/conversationRepository';
import {
  addMessage,
  getMessagePageByConversationId,
} from '../db/messageRepository';
import type { AppStackParamList } from '../navigation/types';
import { pullRemoteMessagesForConversation } from '../services/messagePull';
import { subscribeToConversationMessages } from '../services/messageRealtime';
import { syncMessageById, syncPendingMessages } from '../services/messageSync';
import type { Message } from '../types/message';
import { formatMessageTime } from '../utils/date';

type Navigation = NativeStackNavigationProp<AppStackParamList, 'Chat'>;
type ChatRoute = RouteProp<AppStackParamList, 'Chat'>;

type Props = {
  navigation: Navigation;
  route: ChatRoute;
};

const MESSAGE_PAGE_SIZE = 50;

export default function ChatScreen({ navigation, route }: Props) {
  const { conversationId, title: titleParam } = route.params;
  const { userId, getToken } = useAuth();
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState(titleParam ?? 'Chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<number | null>(
    null,
  );
  const [isAiMenuVisible, setIsAiMenuVisible] = useState(false);
  const [isSummaryVisible, setIsSummaryVisible] = useState(false);
  const [isReplyModalVisible, setIsReplyModalVisible] = useState(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [replySuggestions, setReplySuggestions] = useState<string[]>([]);
  const [error, setError] = useState('');

  const flatListRef = useRef<FlatList<Message>>(null);
  const subscriptionKeyRef = useRef<string | null>(null);
  const activeSyncRef = useRef(false);
  const getTokenRef = useRef(getToken);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom(true);
    }
  }, [messages.length]);

  function scrollToBottom(animated = true) {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated });
    });
  }

  async function getClerkToken(): Promise<string | null> {
    const token = await getTokenRef.current({ template: 'supabase' });
    return typeof token === 'string' ? token : null;
  }

  async function loadThread() {
    const conversation = await getConversationById(conversationId, userId ?? undefined);

    if (!conversation) {
      setError('Conversation not found.');
      setMessages([]);
      return null;
    }

    setTitle(conversation.title ?? 'Chat');
    setError('');

    const page = await getMessagePageByConversationId({
      conversationId,
      currentClerkUserId: userId ?? undefined,
      limit: MESSAGE_PAGE_SIZE,
    });

    setMessages(page.messages);
    setHasOlderMessages(page.hasMore);

    return conversation;
  }

  async function handleLoadOlderMessages() {
    if (isLoadingOlder || !hasOlderMessages || messages.length === 0) {
      return;
    }

    const oldestMessage = messages[0];

    setIsLoadingOlder(true);

    try {
      const page = await getMessagePageByConversationId({
        conversationId,
        currentClerkUserId: userId ?? undefined,
        limit: MESSAGE_PAGE_SIZE,
        beforeCreatedAt: oldestMessage.createdAt,
        beforeId: oldestMessage.id,
      });

      setMessages((currentMessages) => [...page.messages, ...currentMessages]);
      setHasOlderMessages(page.hasMore);
    } catch (loadOlderError) {
      console.warn('Could not load older messages:', loadOlderError);
    } finally {
      setIsLoadingOlder(false);
    }
  }

  async function syncCurrentChat(options?: { showIndicator?: boolean }) {
    if (activeSyncRef.current) {
      return;
    }

    activeSyncRef.current = true;

    if (options?.showIndicator) {
      setIsSyncing(true);
    }

    try {
      const conversation = await getConversationById(
        conversationId,
        userId ?? undefined,
      );

      if (!conversation) {
        setError('Conversation not found.');
        setMessages([]);
        return;
      }

      if (userId) {
        try {
          await syncPendingMessages(userId, getClerkToken);
        } catch (syncError) {
          console.warn('Pending message sync failed. Will retry later:', syncError);
        }
      }

      if (!conversation.remoteId) {
        await loadThread();
        return;
      }

      try {
        await pullRemoteMessagesForConversation({
          localConversationId: conversationId,
          remoteConversationId: conversation.remoteId,
          currentClerkUserId: userId ?? undefined,
          getClerkToken,
        });
      } catch (pullError) {
        console.warn('Chat sync pull failed. Will retry later:', pullError);
      }

      await loadThread();
    } catch (syncError) {
      console.warn('Current chat sync failed. Will retry later:', syncError);
    } finally {
      activeSyncRef.current = false;

      if (options?.showIndicator) {
        setIsSyncing(false);
      }
    }
  }

  async function handleRefresh() {
    setIsRefreshing(true);
  
    try {
      await loadThread();
      await syncCurrentChat({ showIndicator: false });
    } catch (refreshError) {
      console.warn('Chat refresh failed:', refreshError);
  
      try {
        await loadThread();
      } catch (localRefreshError) {
        console.warn('Local refresh also failed:', localRefreshError);
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleRetryMessage(message: Message) {
    if (!userId || retryingMessageId === message.id) {
      return;
    }

    setRetryingMessageId(message.id);

    try {
      await syncMessageById(message.id, userId, getClerkToken);
      await syncCurrentChat({ showIndicator: true });
    } catch (retryError) {
      console.warn('Retry message sync failed:', retryError);
      await loadThread();
    } finally {
      setRetryingMessageId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let channel: any = null;
  
    async function setupThread() {
      setIsLoading(true);
      setError('');
  
      let conversation: Awaited<ReturnType<typeof loadThread>> = null;
  
      /*
       * Step 1: Load locally cached SQLite messages first.
       * This must work even when the phone has no internet connection.
       */
      try {
        conversation = await loadThread();
      } catch (localLoadError) {
        console.warn('Local chat load failed:', localLoadError);
  
        if (!cancelled) {
          setError('Could not load saved chat messages.');
        }
  
        return;
      } finally {
        /*
         * Stop blocking the UI as soon as the local database read completes.
         * Remote sync must never prevent cached messages from being displayed.
         */
        if (!cancelled) {
          setIsLoading(false);
        }
      }
  
      if (cancelled || !conversation || !userId || !conversation.remoteId) {
        return;
      }
  
      /*
       * Step 2: Start realtime subscription independently of the initial
       * remote pull. When offline, Supabase can reconnect later.
       */
      const subscriptionKey = `${conversationId}:${conversation.remoteId}:${userId}`;
  
      if (subscriptionKeyRef.current !== subscriptionKey) {
        try {
          subscriptionKeyRef.current = subscriptionKey;
  
          channel = subscribeToConversationMessages({
            localConversationId: conversationId,
            remoteConversationId: conversation.remoteId,
            currentClerkUserId: userId,
            getClerkToken,
            onMessageSaved: async () => {
              if (!cancelled) {
                await loadThread();
              }
            },
          });
        } catch (subscriptionError) {
          subscriptionKeyRef.current = null;
          console.warn(
            'Realtime subscription could not start. Will retry later:',
            subscriptionError,
          );
        }
      }
  
      /*
       * Step 3: Sync in the background.
       * Do not await this before showing locally saved messages.
       */
      void syncCurrentChat({ showIndicator: false });
    }
  
    setupThread();
  
    return () => {
      cancelled = true;
      subscriptionKeyRef.current = null;
  
      if (channel) {
        channel.unsubscribe();
      }
    };
  }, [conversationId, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncCurrentChat({ showIndicator: true });
      }
    });

    const intervalId = setInterval(() => {
      syncCurrentChat({ showIndicator: false });
    }, 10000);

    return () => {
      appStateSubscription.remove();
      clearInterval(intervalId);
    };
  }, [conversationId, userId]);

  async function handleSend() {
    const text = draft.trim();

    if (!text || isSending) {
      return;
    }

    setIsSending(true);
    setDraft('');

    try {
      const messageId = await addMessage(conversationId, 'user', text, userId);

      await loadThread();
      scrollToBottom(true);

      if (userId) {
        try {
          await syncMessageById(messageId, userId, getClerkToken);
        } catch (syncError) {
          console.warn('Message saved locally but sync failed. Will retry later:', syncError);
        }
      }

      await loadThread();
      scrollToBottom(true);
    } catch (sendError) {
      console.warn('Failed to send message:', sendError);
      setError('Could not send message.');
    } finally {
      setIsSending(false);
    }
  }

  async function handleSummarizeChat() {
    setIsAiMenuVisible(false);
    setIsGeneratingAi(true);
    setSummaryText('');
  
    try {
      const result = await summarizeRecentMessages(
        title,
        messages,
        userId,
      );
  
      setSummaryText(result);
      setIsSummaryVisible(true);
    } catch (summaryError) {
      console.warn('Local summary failed:', summaryError);
      setSummaryText('Could not generate a summary right now.');
      setIsSummaryVisible(true);
    } finally {
      setIsGeneratingAi(false);
    }
  }
  
  async function handleSuggestReplies() {
    setIsAiMenuVisible(false);
    setIsGeneratingAi(true);
    setReplySuggestions([]);
  
    try {
      const result = await suggestRepliesForRecentMessages(
        title,
        messages,
        userId,
      );
  
      setReplySuggestions(result.suggestions);
      setIsReplyModalVisible(true);
    } catch (suggestionError) {
      console.warn('Local reply suggestion failed:', suggestionError);
      setReplySuggestions(['Could not generate suggestions right now.']);
      setIsReplyModalVisible(true);
    } finally {
      setIsGeneratingAi(false);
    }
  }

  function handlePickSuggestion(suggestion: string) {
    setDraft(suggestion);
    setIsReplyModalVisible(false);
  }

  function getOwnMessageStatus(message: Message) {
    if (retryingMessageId === message.id) {
      return 'Retrying...';
    }

    if (message.syncError) {
      return 'Failed · Tap to retry';
    }

    if (!message.synced) {
      return 'Sending...';
    }

    return 'Sent';
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Text style={styles.backLabel}>{'< Back'}</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleWrap}>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {title}
          </Text>

          {isSyncing ? <Text style={styles.syncingText}>Syncing...</Text> : null}
        </View>

        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => setIsAiMenuVisible(true)}
          style={styles.aiBtn}
        >
          <Text style={styles.aiBtnLabel}>AI</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        style={styles.flex}
      >
      {isLoading && messages.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#25D366" />
        </View>
            ) : error && messages.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            contentContainerStyle={styles.listContent}
            data={messages}
            extraData={`${messages.length}-${userId ?? ''}-${retryingMessageId ?? ''}`}
            keyExtractor={(item) => String(item.id)}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            onContentSizeChange={() => scrollToBottom(false)}
            onLayout={() => scrollToBottom(false)}
            refreshControl={
              <RefreshControl
                colors={['#22C55E']}
                progressBackgroundColor="#102820"
                refreshing={isRefreshing}
                tintColor="#22C55E"
                onRefresh={handleRefresh}
              />
            }
            renderItem={({ item }) => {
              const isOwnMessage = item.senderClerkUserId
                ? item.senderClerkUserId === userId
                : item.senderType === 'user';

              const statusText = isOwnMessage
                ? getOwnMessageStatus(item)
                : null;

              return (
                <View
                  style={[
                    styles.bubbleWrap,
                    isOwnMessage
                      ? styles.bubbleWrapUser
                      : styles.bubbleWrapOther,
                  ]}
                >
                  <View
                    style={[
                      styles.bubble,
                      isOwnMessage ? styles.bubbleUser : styles.bubbleOther,
                    ]}
                  >
                    <Text style={styles.bubbleMeta}>
                      {isOwnMessage
                        ? 'You'
                        : item.senderType === 'assistant'
                          ? 'Assistant'
                          : title}
                    </Text>

                    <Text style={styles.bubbleBody}>{item.body}</Text>

                    <View style={styles.messageFooter}>
                      <Text style={styles.messageTime}>
                        {formatMessageTime(item.createdAt)}
                      </Text>

                      {statusText ? (
                        item.syncError ? (
                          <Pressable onPress={() => handleRetryMessage(item)}>
                            <Text style={styles.failedStatus}>{statusText}</Text>
                          </Pressable>
                        ) : (
                          <Text style={styles.messageStatus}>{statusText}</Text>
                        )
                      ) : null}
                    </View>
                  </View>
                </View>
              );
            }}
            ListHeaderComponent={
              hasOlderMessages ? (
                <TouchableOpacity
                  activeOpacity={0.82}
                  disabled={isLoadingOlder}
                  onPress={handleLoadOlderMessages}
                  style={styles.loadOlderButton}
                >
                  <Text style={styles.loadOlderLabel}>
                    {isLoadingOlder ? 'Loading older messages...' : 'Load older messages'}
                  </Text>
                </TouchableOpacity>
              ) : null
            }
            ListEmptyComponent={
              <Text style={styles.emptyThread}>
                No messages yet. Pull down to refresh or say hello below.
              </Text>
            }
          />
        )}

        <View
          style={[
            styles.composer,
            {
              paddingBottom: Math.max(insets.bottom, 8),
            },
          ]}
        >
          <TextInput
            editable={!(isLoading && messages.length === 0) && !Boolean(error)}
            multiline
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor="#789185"
            style={styles.input}
            value={draft}
          />

          <TouchableOpacity
            activeOpacity={0.78}
            disabled={isSending || !draft.trim() || Boolean(error)}
            onPress={handleSend}
            style={[
              styles.sendBtn,
              (isSending || !draft.trim() || Boolean(error)) &&
                styles.sendBtnDisabled,
            ]}
          >
            <Text style={styles.sendLabel}>{isSending ? '...' : 'Send'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal
        animationType="fade"
        onRequestClose={() => setIsAiMenuVisible(false)}
        transparent
        visible={isAiMenuVisible}
      >
        <Pressable
          onPress={() => setIsAiMenuVisible(false)}
          style={styles.modalBackdrop}
        >
          <Pressable style={styles.actionSheet}>
            <Text style={styles.modalTitle}>AI tools</Text>
            <Text style={styles.modalSubtitle}>
              Use recent chat context to summarize or draft a reply.
            </Text>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleSummarizeChat}
              style={styles.actionButton}
            >
              <Text style={styles.actionTitle}>Summarize this chat</Text>
              <Text style={styles.actionDescription}>
                Show a short AI summary in a separate card.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleSuggestReplies}
              style={styles.actionButton}
            >
              <Text style={styles.actionTitle}>Suggest a reply</Text>
              <Text style={styles.actionDescription}>
                Generate 2-3 editable reply suggestions.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setIsAiMenuVisible(false)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonLabel}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsSummaryVisible(false)}
        transparent
        visible={isSummaryVisible}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.resultCard}>
            <Text style={styles.modalTitle}>Chat Summary</Text>
            <Text style={styles.summaryBody}>{summaryText}</Text>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setIsSummaryVisible(false)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonLabel}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsReplyModalVisible(false)}
        transparent
        visible={isReplyModalVisible}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.resultCard}>
            <Text style={styles.modalTitle}>AI Reply Suggestions</Text>
            <Text style={styles.modalSubtitle}>
              Tap a suggestion to fill the message box. You can edit before sending.
            </Text>

            {replySuggestions.map((suggestion, index) => (
              <TouchableOpacity
                key={`${suggestion}-${index}`}
                activeOpacity={0.85}
                onPress={() => handlePickSuggestion(suggestion)}
                style={styles.suggestionButton}
              >
                <Text style={styles.suggestionIndex}>{index + 1}.</Text>
                <Text style={styles.suggestionText}>{suggestion}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setIsReplyModalVisible(false)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonLabel}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {isGeneratingAi ? (
        <View pointerEvents="none" style={styles.aiLoadingOverlay}>
          <View style={styles.aiLoadingCard}>
            <ActivityIndicator color="#25D366" />
            <Text style={styles.aiLoadingText}>AI is preparing a response...</Text>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#071A14',
  },
  flex: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: '#1D3B31',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  backBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  backLabel: {
    color: '#25D366',
    fontSize: 17,
    fontWeight: '800',
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  syncingText: {
    color: '#8AA398',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  aiBtn: {
    alignItems: 'center',
    backgroundColor: '#25D366',
    borderRadius: 18,
    justifyContent: 'center',
    minWidth: 52,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  aiBtnLabel: {
    color: '#071A14',
    fontSize: 14,
    fontWeight: '900',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    color: '#FFB4A8',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingBottom: 8,
  },
  bubbleWrap: {
    marginBottom: 10,
    flexDirection: 'row',
  },
  bubbleWrapUser: {
    justifyContent: 'flex-end',
  },
  bubbleWrapOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '86%',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: '#0F4D3A',
    borderColor: '#1D6B52',
    borderWidth: 1,
  },
  bubbleOther: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderWidth: 1,
  },
  bubbleMeta: {
    color: '#8AA398',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  bubbleBody: {
    color: '#E8F5EF',
    fontSize: 15,
    lineHeight: 21,
  },
  messageFooter: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  messageTime: {
    color: '#8AA398',
    fontSize: 11,
    fontWeight: '700',
  },
  messageStatus: {
    color: '#8AA398',
    fontSize: 11,
    fontWeight: '700',
  },
  failedStatus: {
    color: '#FFB4A8',
    fontSize: 11,
    fontWeight: '800',
  },
  emptyThread: {
    color: '#8AA398',
    fontSize: 14,
    marginTop: 24,
    textAlign: 'center',
  },
  loadOlderButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  loadOlderLabel: {
    color: '#A6BBB1',
    fontSize: 13,
    fontWeight: '800',
  },
  composer: {
    alignItems: 'flex-end',
    borderTopColor: '#1D3B31',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: '#071A14',
  },
  input: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 18,
    borderWidth: 1,
    color: '#FFFFFF',
    flex: 1,
    fontSize: 16,
    maxHeight: 110,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    textAlignVertical: 'top',
  },
  sendBtn: {
    backgroundColor: '#25D366',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
  sendLabel: {
    color: '#071A14',
    fontSize: 15,
    fontWeight: '900',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(3, 10, 8, 0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  actionSheet: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    width: '100%',
    maxWidth: 420,
  },
  resultCard: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    width: '100%',
    maxWidth: 420,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  modalSubtitle: {
    color: '#A6BBB1',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  actionButton: {
    backgroundColor: '#0F4D3A',
    borderColor: '#1D6B52',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  actionTitle: {
    color: '#F4FFF9',
    fontSize: 16,
    fontWeight: '800',
  },
  actionDescription: {
    color: '#A6BBB1',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  summaryBody: {
    color: '#E8F5EF',
    fontSize: 15,
    lineHeight: 23,
    marginTop: 14,
  },
  suggestionButton: {
    alignItems: 'flex-start',
    backgroundColor: '#0C211B',
    borderColor: '#1D3B31',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  suggestionIndex: {
    color: '#25D366',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 1,
  },
  suggestionText: {
    color: '#E8F5EF',
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#25D366',
    borderRadius: 16,
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  primaryButtonLabel: {
    color: '#071A14',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#1D3B31',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  secondaryButtonLabel: {
    color: '#E8F5EF',
    fontSize: 15,
    fontWeight: '800',
  },
  aiLoadingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(3, 10, 8, 0.42)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  aiLoadingCard: {
    alignItems: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  aiLoadingText: {
    color: '#E8F5EF',
    fontSize: 14,
    fontWeight: '700',
  },
});
