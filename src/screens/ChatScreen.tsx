/**
 * Single-conversation thread: loads messages from SQLite and supports sending.
 */
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '@clerk/expo';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getConversationById } from '../db/conversationRepository';
import { addMessage, getMessagesByConversationId } from '../db/messageRepository';
import type { AppStackParamList } from '../navigation/types';
import { syncMessageById } from '../services/messageSync';
import type { Message } from '../types/message';
import { formatMessageTime } from '../utils/date';

type Navigation = NativeStackNavigationProp<AppStackParamList, 'Chat'>;
type ChatRoute = RouteProp<AppStackParamList, 'Chat'>;

type Props = {
  navigation: Navigation;
  route: ChatRoute;
};

export default function ChatScreen({ navigation, route }: Props) {
  const { conversationId, title: titleParam } = route.params;
  const { userId } = useAuth();
  const [title, setTitle] = useState(titleParam ?? 'Chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  const loadThread = useCallback(async () => {
    const conversation = await getConversationById(conversationId);
    if (!conversation) {
      setError('Conversation not found.');
      setMessages([]);
      return;
    }

    setTitle(conversation.title ?? 'Chat');
    setError('');
    const rows = await getMessagesByConversationId(conversationId);
    setMessages(rows);
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      try {
        await loadThread();
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [loadThread]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || isSending) {
      return;
    }

    setIsSending(true);
    setDraft('');
    try {
      const messageId = await addMessage(conversationId, 'user', text);
      if (userId) {
        await syncMessageById(messageId, userId);
      }
      await loadThread();
    } finally {
      setIsSending(false);
    }
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
        <Text numberOfLines={1} style={styles.headerTitle}>
          {title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        style={styles.flex}
      >
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#25D366" />
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={messages}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.bubbleWrap,
                  item.senderType === 'user' ? styles.bubbleWrapUser : styles.bubbleWrapOther,
                ]}
              >
                <View
                  style={[
                    styles.bubble,
                    item.senderType === 'user' ? styles.bubbleUser : styles.bubbleOther,
                  ]}
                >
                  <Text style={styles.bubbleMeta}>
                    {item.senderType === 'user'
                      ? 'You'
                      : item.senderType === 'assistant'
                        ? 'Assistant'
                        : 'System'}
                  </Text>
                  <Text style={styles.bubbleBody}>{item.body}</Text>
                  <Text style={styles.messageTime}>
                    {formatMessageTime(item.createdAt)}
                  </Text>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyThread}>No messages yet. Say hello below.</Text>
            }
          />
        )}

        <View style={styles.composer}>
          <TextInput
            editable={!isLoading && !error}
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
              (isSending || !draft.trim() || error) && styles.sendBtnDisabled,
            ]}
          >
            <Text style={styles.sendLabel}>{isSending ? '...' : 'Send'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
  headerTitle: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 72,
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
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingBottom: 8,
    flexGrow: 1,
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
  messageTime: {
    alignSelf: 'flex-end',
    color: '#8AA398',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
  },
  emptyThread: {
    color: '#8AA398',
    fontSize: 14,
    marginTop: 24,
    textAlign: 'center',
  },
  composer: {
    alignItems: 'flex-end',
    borderTopColor: '#1D3B31',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 18 : 12,
    backgroundColor: '#071A14',
  },
  input: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 12,
    borderWidth: 1,
    color: '#FFFFFF',
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendBtn: {
    backgroundColor: '#25D366',
    borderRadius: 12,
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
});
