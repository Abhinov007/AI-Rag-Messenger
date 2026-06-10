/**
 * Single-conversation thread: loads messages from SQLite, supports sending,
 * pulls remote messages, subscribes to realtime Supabase inserts,
 * supports pull-to-refresh, retries sync, shows message sync status,
 * and keeps the composer above the keyboard.
 */
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '@clerk/expo';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  ScrollView,
  Keyboard,
} from 'react-native';

import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  isLocalAiModelInstalled,
  LOCAL_AI_NOT_INSTALLED_MESSAGE,
} from '../ai/localAiModel';
import {
  answerQuestionFromRetrievedMessages,
  calculateDraftReductionPercent,
  condenseOutgoingMessage,
  MIN_CHARACTERS_FOR_CONDENSE,
  suggestRepliesForRecentMessages,
  summarizeRecentMessages,
  type CondensedOutgoingMessageResult,
  type RagAnswerResult,
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
import { searchConversationMessages } from '../services/ragSearch';
import { deleteMessageForCurrentUser } from '../db/messageRepository';
import { sendOfflineChatMessage } from '../services/offlineMeshService';
import { clearMessageSyncError } from '../db/messageRepository';



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

  const [isAskChatVisible, setIsAskChatVisible] = useState(false);
  const [ragQuestion, setRagQuestion] = useState('');
  const [ragResult, setRagResult] = useState<RagAnswerResult | null>(null);
  const [ragError, setRagError] = useState('');
  const [isGeneratingRagAnswer, setIsGeneratingRagAnswer] = useState(false);
  const [pendingAskChatOpen, setPendingAskChatOpen] = useState(false);

  const [isCondensingMessage, setIsCondensingMessage] = useState(false);
  const [isCondensePreviewVisible, setIsCondensePreviewVisible] =
    useState(false);
  const [condenseError, setCondenseError] = useState('');
  const [condensedResult, setCondensedResult] =
    useState<CondensedOutgoingMessageResult | null>(null);
  const [editableCondensedText, setEditableCondensedText] = useState('');

  /*
   * Remember the exact text dismissed or accepted, rather than hiding the
   * feature permanently after one click.
   */
  const [dismissedCondenseDraft, setDismissedCondenseDraft] = useState('');
  const [appliedCondensedDraft, setAppliedCondensedDraft] = useState('');

  const trimmedDraft = draft.trim();

  const shouldOfferCondense =
    trimmedDraft.length >= MIN_CHARACTERS_FOR_CONDENSE &&
    trimmedDraft !== dismissedCondenseDraft &&
    trimmedDraft !== appliedCondensedDraft &&
    !isCondensingMessage &&
    !isCondensePreviewVisible;

  const editedCondensedCharacterCount = editableCondensedText.trim().length;

  const editedReductionPercent = condensedResult
    ? calculateDraftReductionPercent(
        condensedResult.originalCharacterCount,
        editedCondensedCharacterCount,
      )
    : 0;

  const canUseCondensedDraft =
    Boolean(condensedResult) &&
    editedCondensedCharacterCount > 0 &&
    editedCondensedCharacterCount <
      (condensedResult?.originalCharacterCount ?? 0);


  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom(true);
    }
  }, [messages.length]);

  useEffect(() => {
    if (!pendingAskChatOpen || isAiMenuVisible) {
      return;
    }
  
    const timer = setTimeout(() => {
      console.log('Ask About Chat modal now visible');
  
      setRagQuestion('');
      setRagResult(null);
      setRagError('');
      setIsAskChatVisible(true);
      setPendingAskChatOpen(false);
    }, 250);
  
    return () => clearTimeout(timer);
  }, [isAiMenuVisible, pendingAskChatOpen]);

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
    const conversation = await getConversationById(
      conversationId,
      userId ?? undefined,
    );
  
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
          console.warn(
            'Pending message sync failed. Will retry later:',
            syncError,
          );
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

  const handleDeleteMessage = useCallback(
    (message: Message) => {
      Alert.alert(
        'Delete message?',
        'This message will be removed from this chat on your device.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteMessageForCurrentUser(message.id);
  
                setMessages(currentMessages =>
                  currentMessages.filter(
                    currentMessage => currentMessage.id !== message.id,
                  ),
                );
              } catch (error) {
                console.error('Failed to delete message:', error);
  
                Alert.alert(
                  'Delete failed',
                  'Unable to delete this message. Please try again.',
                );
              }
            },
          },
        ],
      );
    },
    [],
  );

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

    const appStateSubscription = AppState.addEventListener(
      'change',
      (state) => {
        if (state === 'active') {
          syncCurrentChat({ showIndicator: true });
        }
      },
    );

    const intervalId = setInterval(() => {
      syncCurrentChat({ showIndicator: false });
    }, 10000);

    return () => {
      appStateSubscription.remove();
      clearInterval(intervalId);
    };
  }, [conversationId, userId]);

  function resetCondenseComposerState() {
    setIsCondensingMessage(false);
    setIsCondensePreviewVisible(false);
    setCondenseError('');
    setCondensedResult(null);
    setEditableCondensedText('');
    setDismissedCondenseDraft('');
    setAppliedCondensedDraft('');
  }

  function handleDraftChange(text: string) {
    setDraft(text);
    setCondenseError('');

    if (text.trim().length === 0) {
      resetCondenseComposerState();
    }
  }

  async function handleCondenseOutgoingDraft() {
    const originalDraft = draft.trim();

    console.log('Condense button tapped:', {
      draftLength: originalDraft.length,
      threshold: MIN_CHARACTERS_FOR_CONDENSE,
    });

    if (originalDraft.length < MIN_CHARACTERS_FOR_CONDENSE) {
      setCondenseError(
        `Type at least ${MIN_CHARACTERS_FOR_CONDENSE} characters before condensing.`,
      );
      return;
    }

    if (!(await isLocalAiModelInstalled())) {
      Alert.alert('Local AI setup needed', LOCAL_AI_NOT_INSTALLED_MESSAGE);
      return;
    }

    setCondenseError('');
    setIsCondensingMessage(true);

    try {
      const result = await condenseOutgoingMessage(originalDraft);

      console.log('Condensed message generated:', {
        originalCharacterCount: result.originalCharacterCount,
        condensedCharacterCount: result.condensedCharacterCount,
        reductionPercent: result.reductionPercent,
      });

      setCondensedResult(result);
      setEditableCondensedText(result.condensedText);
      setIsCondensePreviewVisible(true);
    } catch (condenseFailure) {
      const message =
        condenseFailure instanceof Error
          ? condenseFailure.message
          : 'Could not shorten this message right now.';

      console.warn('Outgoing message condensation failed:', condenseFailure);
      setCondenseError(message);
    } finally {
      setIsCondensingMessage(false);
    }
  }

  function handleDismissCondenseOffer() {
    setCondenseError('');
    setDismissedCondenseDraft(draft.trim());
  }

  function handleKeepOriginalDraft() {
    Keyboard.dismiss();
    setIsCondensePreviewVisible(false);
    setCondensedResult(null);
    setEditableCondensedText('');
    setCondenseError('');
    setDismissedCondenseDraft(draft.trim());
  }

  function handleUseCondensedDraft() {
    const approvedCondensedText = editableCondensedText.trim();

    if (!condensedResult || !approvedCondensedText) {
      setCondenseError('The shortened message cannot be empty.');
      return;
    }

    if (
      approvedCondensedText.length >= condensedResult.originalCharacterCount
    ) {
      setCondenseError(
        'The edited version must be shorter than your original message.',
      );
      return;
    }

    Keyboard.dismiss();
    setDraft(approvedCondensedText);
    setAppliedCondensedDraft(approvedCondensedText);
    setDismissedCondenseDraft('');
    setCondenseError('');
    setIsCondensePreviewVisible(false);
    setCondensedResult(null);
    setEditableCondensedText('');
  }

  async function handleSend() {
    const text = draft.trim();
  
    if (!text || isSending || isCondensingMessage) {
      return;
    }
  
    setIsSending(true);
  
    try {
      const messageId = await addMessage(conversationId, 'user', text, userId);
  
      /*
       * Only clear the composer after SQLite successfully stores the message.
       * This prevents losing the user's draft if local saving fails.
       */
      setDraft('');
      resetCondenseComposerState();
  
      await loadThread();
      scrollToBottom(true);
  
      /*
       * Get the latest conversation directly here.
       * This avoids useState/scope issues with offlineRecipientClerkUserId.
       */
      const conversation = await getConversationById(
        conversationId,
        userId ?? undefined,
      );
      
      const recipientClerkUserId = conversation?.contactClerkUserId ?? null;
      const participantKey = conversation?.participantKey ?? null;
      
      console.log('Offline send check:', {
        userId,
        conversationId,
        messageId,
        recipientClerkUserId,
        participantKey,
        bodyLength: text.length,
      });
      
      if (userId && recipientClerkUserId) {
        void sendOfflineChatMessage({
          recipientClerkUserId,
          senderClerkUserId: userId,
          localMessageId: messageId,
          conversationId,
          participantKey,
          body: text,
        }).catch((offlineError: unknown) => {
          console.warn('Offline mesh send failed:', offlineError);
        });
      } else {
        console.warn('Offline mesh send skipped:', {
          hasUserId: Boolean(userId),
          hasRecipientClerkUserId: Boolean(recipientClerkUserId),
          recipientClerkUserId,
          conversation,
        });
      }
  
      const offlineConversation = conversation as {
        contactClerkUserId?: string | null;
        participantKey?: string | null;
      } | null;
  

  
      console.log('Offline send check:', {
        userId,
        conversationId,
        messageId,
        recipientClerkUserId,
        participantKey,
        bodyLength: text.length,
      });
  
      /*
       * Offline Protocol send.
       * This does not need internet. It only needs BLE mesh to be running.
       */
      if (userId && recipientClerkUserId) {
        void sendOfflineChatMessage({
          recipientClerkUserId,
          senderClerkUserId: userId,
          localMessageId: messageId,
          conversationId,
          participantKey,
          body: text,
        }).catch((offlineError: unknown) => {
          console.warn('Offline mesh send failed:', offlineError);
        });
      } else {
        console.warn('Offline mesh send skipped:', {
          hasUserId: Boolean(userId),
          hasRecipientClerkUserId: Boolean(recipientClerkUserId),
          recipientClerkUserId,
        });
      }
  
      /*
       * Supabase sync remains separate.
       * If internet is off, this may fail, but local save + offline mesh send
       * already happened above.
       */
      if (userId) {
        try {
          await syncMessageById(messageId, userId, getClerkToken);
        } catch (syncError) {
          console.warn(
            'Message saved locally. Supabase sync failed, keeping it queued:',
            syncError,
          );
      
          /**
           * Important:
           * Supabase/Clerk network failure should NOT make the chat bubble red.
           * The message is already saved locally and offline mesh may still deliver it.
           */
          await clearMessageSyncError(messageId);
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

    if (!(await isLocalAiModelInstalled())) {
      Alert.alert('Local AI setup needed', LOCAL_AI_NOT_INSTALLED_MESSAGE);
      return;
    }

    setIsGeneratingAi(true);
    setSummaryText('');

    try {
      const result = await summarizeRecentMessages(title, messages, userId);

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

    if (!(await isLocalAiModelInstalled())) {
      Alert.alert('Local AI setup needed', LOCAL_AI_NOT_INSTALLED_MESSAGE);
      return;
    }

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

  function handleOpenAskChat() {
    if (pendingAskChatOpen || isAskChatVisible) {
      return;
    }
  
    console.log('Ask About Chat requested');
  
    setPendingAskChatOpen(true);
    setIsAiMenuVisible(false);
  }
  
  async function handleAskAboutChat() {
    const question = ragQuestion.trim();
  
    if (!question) {
      setRagError('Enter a question about this chat.');
      return;
    }
    
    setRagError('');
    setRagResult(null);
    setIsGeneratingRagAnswer(true);
  
    try {
      const conversation = await getConversationById(
        conversationId,
        userId ?? undefined,
      );
  
      if (!conversation) {
        throw new Error('Conversation not found locally.');
      }
  
      if (!conversation.remoteId) {
        throw new Error(
          'This conversation has not been synchronized yet. Online RAG currently searches synced messages only.',
        );
      }
  
      const retrievedMessages = await searchConversationMessages({
        remoteConversationId: conversation.remoteId,
        question,
        participantName: title,
        getClerkToken,
        matchCount: 8,
      });
  
      if (__DEV__) {
        console.log('RAG retrieved messages:', retrievedMessages);
      }
  
      const answer = await answerQuestionFromRetrievedMessages(
        question,
        retrievedMessages,
        userId,
        title,
      );
  
      setRagResult(answer);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not answer this question right now.';
  
      console.warn('Ask about chat failed:', error);
      setRagError(message);
    } finally {
      setIsGeneratingRagAnswer(false);
    }
    console.log('Ask About Chat submitted:', question);
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

          {isSyncing ? (
            <Text style={styles.syncingText}>Syncing...</Text>
          ) : null}
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
            keyboardDismissMode={
              Platform.OS === 'ios' ? 'interactive' : 'on-drag'
            }
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
                            <Text style={styles.failedStatus}>
                              {statusText}
                            </Text>
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
                    {isLoadingOlder
                      ? 'Loading older messages...'
                      : 'Load older messages'}
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

{draft.trim().length > 0 && (
  <Text style={styles.condenseDebugText}>
    Draft length: {draft.trim().length} / {MIN_CHARACTERS_FOR_CONDENSE}
  </Text>
)}
{shouldOfferCondense && (
          <View style={styles.condenseBanner}>
            <View style={styles.condenseBannerContent}>
              <Text style={styles.condenseBannerTitle}>
                Long message detected
              </Text>

              <Text style={styles.condenseBannerDescription}>
                Shorten it locally with AI before sending to reduce message
                size.
              </Text>
            </View>

            <View style={styles.condenseBannerActions}>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={isCondensingMessage}
                onPress={handleCondenseOutgoingDraft}
                style={styles.condensePrimaryButton}
              >
                <Text style={styles.condensePrimaryButtonText}>
                  Condense
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.85}
                disabled={isCondensingMessage}
                onPress={handleDismissCondenseOffer}
                style={styles.condenseDismissButton}
              >
                <Text style={styles.condenseDismissButtonText}>
                  Dismiss
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isCondensingMessage && (
          <View style={styles.condenseLoadingBanner}>
            <ActivityIndicator color="#25D366" size="small" />
            <Text style={styles.condenseLoadingText}>
              Shortening your message locally...
            </Text>
          </View>
        )}

        {condenseError.length > 0 && !isCondensePreviewVisible && (
          <View style={styles.condenseErrorBanner}>
            <Text style={styles.condenseErrorText}>{condenseError}</Text>
          </View>
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
            editable={
              !(isLoading && messages.length === 0) &&
              !Boolean(error) &&
              !isCondensingMessage
            }
            multiline
            onChangeText={handleDraftChange}
            placeholder="Message"
            placeholderTextColor="#789185"
            style={styles.input}
            value={draft}
          />

          <TouchableOpacity
            activeOpacity={0.78}
            disabled={
              isSending ||
              isCondensingMessage ||
              !draft.trim() ||
              Boolean(error)
            }
            onPress={handleSend}
            style={[
              styles.sendBtn,
              (isSending ||
                isCondensingMessage ||
                !draft.trim() ||
                Boolean(error)) &&
                styles.sendBtnDisabled,
            ]}
          >
            <Text style={styles.sendLabel}>
              {isSending ? '...' : 'Send'}
            </Text>
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
        Generate local AI responses or ask grounded questions about this chat.
      </Text>

      <TouchableOpacity
        activeOpacity={0.85}
        disabled={
          isGeneratingAi ||
          isGeneratingRagAnswer ||
          pendingAskChatOpen
        }
        onPress={handleSummarizeChat}
        style={styles.actionButton}
      >
        <Text style={styles.actionTitle}>Summarize this chat</Text>
        <Text style={styles.actionDescription}>
          Generate a short summary using the local model.
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        activeOpacity={0.85}
        disabled={
          isGeneratingAi ||
          isGeneratingRagAnswer ||
          pendingAskChatOpen
        }
        onPress={handleSuggestReplies}
        style={styles.actionButton}
      >
        <Text style={styles.actionTitle}>Suggest a reply</Text>
        <Text style={styles.actionDescription}>
          Generate editable reply suggestions locally.
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
  activeOpacity={0.85}
  disabled={
    isGeneratingAi ||
    isGeneratingRagAnswer ||
    pendingAskChatOpen
  }
  onPress={handleOpenAskChat}
  style={styles.actionButton}
>
  <Text style={styles.actionTitle}>
    {pendingAskChatOpen ? 'Opening...' : 'Ask about this chat'}
  </Text>
  <Text style={styles.actionDescription}>
    Search relevant messages and generate a grounded local answer.
  </Text>
</TouchableOpacity>

      <TouchableOpacity
        activeOpacity={0.85}
        disabled={
          isGeneratingAi ||
          isGeneratingRagAnswer ||
          pendingAskChatOpen
        }
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
  onRequestClose={() => setIsAskChatVisible(false)}
  transparent
  visible={isAskChatVisible}
>
  <KeyboardAvoidingView
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    keyboardVerticalOffset={0}
    style={styles.ragKeyboardAvoiding}
  >
    <Pressable
      onPress={Keyboard.dismiss}
      style={styles.ragBackdrop}
    >
      <Pressable
        onPress={(event) => event.stopPropagation()}
        style={styles.ragModal}
      >
        <Text style={styles.modalTitle}>Ask about this chat</Text>

        <Text style={styles.modalSubtitle}>
          Relevant synced messages are retrieved from Supabase. Your answer is
          generated locally on this phone.
        </Text>

        <TextInput
          editable={!isGeneratingRagAnswer}
          multiline
          onChangeText={(text) => {
            setRagQuestion(text);
            setRagError('');
          }}
          placeholder={`What do you want to ask?`}
          placeholderTextColor="#8b949e"
          returnKeyType="done"
          style={styles.ragQuestionInput}
          textAlignVertical="top"
          value={ragQuestion}
        />

        {ragError.length > 0 && (
          <Text style={styles.ragErrorText}>{ragError}</Text>
        )}

        <TouchableOpacity
          activeOpacity={0.85}
          disabled={isGeneratingRagAnswer || ragQuestion.trim().length === 0}
          onPress={() => {
            Keyboard.dismiss();
            handleAskAboutChat();
          }}
          style={[
            styles.actionButton,
            (isGeneratingRagAnswer || ragQuestion.trim().length === 0) &&
              styles.ragDisabledButton,
          ]}
        >
          <Text style={styles.actionTitle}>
            {isGeneratingRagAnswer ? 'Answering...' : 'Ask locally'}
          </Text>

          <Text style={styles.actionDescription}>
            Search this conversation and answer using local Llama.
          </Text>
        </TouchableOpacity>

        {isGeneratingRagAnswer && (
          <View style={styles.ragLoadingContainer}>
            <ActivityIndicator color="#25D366" size="large" />
            <Text style={styles.ragLoadingText}>
              Retrieving messages and generating an answer...
            </Text>
          </View>
        )}

        {ragResult && (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.ragResultScroll}
          >
            <Text style={styles.ragSectionLabel}>Answer</Text>
            <Text style={styles.ragAnswer}>{ragResult.answer}</Text>

            <Text style={styles.ragSectionLabel}>Sources</Text>

            {ragResult.sources.length === 0 ? (
              <Text style={styles.ragNoSources}>
                No relevant message sources were found.
              </Text>
            ) : (
              ragResult.sources.map((source) => (
                <View key={source.id} style={styles.ragSourceCard}>
                  <Text style={styles.ragSourceSpeaker}>{source.speaker}</Text>
                  <Text style={styles.ragSourceBody}>{source.body}</Text>
                </View>
              ))
            )}
          </ScrollView>
        )}

        <TouchableOpacity
          activeOpacity={0.85}
          disabled={isGeneratingRagAnswer}
          onPress={() => {
            Keyboard.dismiss();
            setIsAskChatVisible(false);
          }}
          style={[
            styles.secondaryButton,
            isGeneratingRagAnswer && styles.ragDisabledButton,
          ]}
        >
          <Text style={styles.secondaryButtonLabel}>Close</Text>
        </TouchableOpacity>
      </Pressable>
    </Pressable>
  </KeyboardAvoidingView>
</Modal>

            <Modal
        animationType="slide"
        onRequestClose={handleKeepOriginalDraft}
        transparent
        visible={isCondensePreviewVisible}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
          style={styles.condenseKeyboardAvoiding}
        >
          <View style={styles.condenseModalBackdrop}>
            <View style={styles.condenseModal}>
              <Text style={styles.condenseModalTitle}>
                Condensed message preview
              </Text>

              <Text style={styles.condenseModalSubtitle}>
                Generated locally on your phone. Review and edit before
                sending.
              </Text>

              {condensedResult && (
                <>
                  <View style={styles.condenseStatsRow}>
                    <View style={styles.condenseStatCard}>
                      <Text style={styles.condenseStatValue}>
                        {condensedResult.originalCharacterCount}
                      </Text>
                      <Text style={styles.condenseStatLabel}>
                        Original chars
                      </Text>
                    </View>

                    <View style={styles.condenseStatCard}>
                      <Text style={styles.condenseStatValue}>
                        {editedCondensedCharacterCount}
                      </Text>
                      <Text style={styles.condenseStatLabel}>
                        New chars
                      </Text>
                    </View>

                    <View style={styles.condenseStatCard}>
                      <Text style={styles.condenseStatValue}>
                        {editedReductionPercent}%
                      </Text>
                      <Text style={styles.condenseStatLabel}>
                        Reduced
                      </Text>
                    </View>
                  </View>

                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    style={styles.condensePreviewScroll}
                  >
                    <Text style={styles.condenseSectionLabel}>Original</Text>

                    <View style={styles.condenseOriginalCard}>
                      <Text style={styles.condenseOriginalText}>
                        {condensedResult.originalText}
                      </Text>
                    </View>

                    <Text style={styles.condenseSectionLabel}>
                      AI-condensed message
                    </Text>

                    <TextInput
                      editable={!isCondensingMessage}
                      multiline
                      onChangeText={(text) => {
                        setEditableCondensedText(text);
                        setCondenseError('');
                      }}
                      placeholder="Shortened message"
                      placeholderTextColor="#789185"
                      style={styles.condenseEditableInput}
                      textAlignVertical="top"
                      value={editableCondensedText}
                    />

                    {!canUseCondensedDraft &&
                      editableCondensedText.trim().length > 0 && (
                        <Text style={styles.condenseInlineWarning}>
                          The edited version must stay shorter than the
                          original.
                        </Text>
                      )}

                    {condenseError.length > 0 && (
                      <Text style={styles.condenseInlineWarning}>
                        {condenseError}
                      </Text>
                    )}
                  </ScrollView>

                  <TouchableOpacity
                    activeOpacity={0.85}
                    disabled={!canUseCondensedDraft}
                    onPress={handleUseCondensedDraft}
                    style={[
                      styles.condenseUseButton,
                      !canUseCondensedDraft &&
                        styles.condenseDisabledButton,
                    ]}
                  >
                    <Text style={styles.condenseUseButtonText}>
                      Use Condensed Version
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={handleKeepOriginalDraft}
                    style={styles.condenseKeepButton}
                  >
                    <Text style={styles.condenseKeepButtonText}>
                      Keep Original Message
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
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
              Tap a suggestion to fill the message box. You can edit before
              sending.
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
            <Text style={styles.aiLoadingText}>
              AI is preparing a response...
            </Text>
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
  ragModal: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    bottom: 0,
    left: 0,
    maxHeight: '88%',
    padding: 20,
    position: 'absolute',
    right: 0,
  },

  ragQuestionInput: {
    backgroundColor: '#f3f4f6',
    borderColor: '#e5e7eb',
    borderRadius: 14,
    borderWidth: 1,
    color: '#111827',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 14,
    minHeight: 84,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },

  ragErrorText: {
    color: '#dc2626',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },

  ragDisabledButton: {
    opacity: 0.5,
  },

  ragLoadingContainer: {
    alignItems: 'center',
    marginVertical: 18,
  },

  ragLoadingText: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },

  ragResultScroll: {
    marginBottom: 12,
    marginTop: 8,
    maxHeight: 330,
  },

  ragSectionLabel: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 12,
    textTransform: 'uppercase',
  },

  ragAnswer: {
    color: '#111827',
    fontSize: 15,
    lineHeight: 23,
  },

  ragNoSources: {
    color: '#6b7280',
    fontSize: 14,
    lineHeight: 20,
  },

  ragSourceCard: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  ragSourceSpeaker: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },

  ragSourceBody: {
    color: '#374151',
    fontSize: 14,
    lineHeight: 20,
  },
  ragKeyboardAvoiding: {
    flex: 1,
  },
  
  ragBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  condenseBanner: {
    backgroundColor: '#102820',
    borderColor: '#1D6B52',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    marginHorizontal: 12,
    padding: 12,
  },
  condenseBannerContent: {
    marginBottom: 10,
  },
  condenseBannerTitle: {
    color: '#E8F5EF',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  condenseBannerDescription: {
    color: '#A6BBB1',
    fontSize: 13,
    lineHeight: 18,
  },
  condenseBannerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  condensePrimaryButton: {
    backgroundColor: '#25D366',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  condensePrimaryButtonText: {
    color: '#071A14',
    fontSize: 13,
    fontWeight: '800',
  },
  condenseDismissButton: {
    backgroundColor: '#17382D',
    borderColor: '#1D6B52',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  condenseDismissButtonText: {
    color: '#A6BBB1',
    fontSize: 13,
    fontWeight: '700',
  },
  condenseLoadingBanner: {
    alignItems: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D6B52',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  condenseLoadingText: {
    color: '#A6BBB1',
    fontSize: 13,
  },
  condenseErrorBanner: {
    backgroundColor: '#341A1A',
    borderColor: '#7F3535',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    marginHorizontal: 12,
    padding: 10,
  },
  condenseErrorText: {
    color: '#FFB4A8',
    fontSize: 13,
    lineHeight: 18,
  },
  condenseKeyboardAvoiding: {
    flex: 1,
  },
  condenseModalBackdrop: {
    backgroundColor: 'rgba(3, 10, 8, 0.72)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  condenseModal: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    maxHeight: '92%',
    padding: 20,
    paddingBottom: 24,
  },
  condenseModalTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
  },
  condenseModalSubtitle: {
    color: '#A6BBB1',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  condenseStatsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  condenseStatCard: {
    alignItems: 'center',
    backgroundColor: '#17382D',
    borderRadius: 12,
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  condenseStatValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  condenseStatLabel: {
    color: '#8AA398',
    fontSize: 11,
    marginTop: 3,
    textAlign: 'center',
  },
  condensePreviewScroll: {
    marginBottom: 14,
    maxHeight: 400,
  },
  condenseSectionLabel: {
    color: '#8AA398',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 7,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  condenseOriginalCard: {
    backgroundColor: '#071A14',
    borderColor: '#1D3B31',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 11,
  },
  condenseOriginalText: {
    color: '#A6BBB1',
    fontSize: 13,
    lineHeight: 19,
  },
  condenseEditableInput: {
    backgroundColor: '#071A14',
    borderColor: '#1D6B52',
    borderRadius: 12,
    borderWidth: 1,
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 21,
    minHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  condenseInlineWarning: {
    color: '#FFB4A8',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  condenseUseButton: {
    alignItems: 'center',
    backgroundColor: '#25D366',
    borderRadius: 13,
    marginBottom: 9,
    paddingVertical: 13,
  },
  condenseUseButtonText: {
    color: '#071A14',
    fontSize: 15,
    fontWeight: '800',
  },
  condenseKeepButton: {
    alignItems: 'center',
    backgroundColor: '#17382D',
    borderColor: '#1D3B31',
    borderRadius: 13,
    borderWidth: 1,
    paddingVertical: 13,
  },
  condenseKeepButtonText: {
    color: '#E8F5EF',
    fontSize: 15,
    fontWeight: '700',
  },
  condenseDisabledButton: {
    opacity: 0.45,
  },
  condenseDebugText: {
    color: '#8AA398',
    fontSize: 12,
    marginBottom: 6,
    marginHorizontal: 12,
    textAlign: 'right',
  }
});
