/**
 * Chat list screen.
 *
 * After authentication, this screen renders the conversation list from local
 * SQLite storage initialized by the app root.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ConversationItem from '../components/ConversationItem';
import { listConversations } from '../db/conversationRepository';
import type { ConversationListItem } from '../types/conversation';

type Props = {
  onLogout: () => void;
};

/**
 * Displays locally stored conversations and exposes a temporary logout action.
 */
export default function ChatListScreen({ onLogout }: Props) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadConversations() {
      try {
        const conversations = await listConversations();

        if (isMounted) {
          setConversations(conversations);
          setError('');
        }
      } catch {
        if (isMounted) {
          setError('Could not load conversations.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadConversations();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>AI RAG Chat</Text>
          <Text style={styles.title}>Chats</Text>
        </View>

        <Pressable
          onPress={onLogout}
          style={({ pressed }) => [
            styles.logoutButton,
            pressed && styles.logoutButtonPressed,
          ]}
        >
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={conversations}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <ConversationItem conversation={item} />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {isLoading ? (
              <ActivityIndicator color="#25D366" />
            ) : (
              <>
                <Text style={styles.emptyTitle}>
                  {error || 'No conversations yet'}
                </Text>
                <Text style={styles.emptyText}>
                  New chats will appear here after they are created.
                </Text>
              </>
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#071A14',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
  },
  kicker: {
    color: '#25D366',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    marginTop: 4,
  },
  logoutButton: {
    borderColor: '#2E4B40',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  logoutButtonPressed: {
    opacity: 0.68,
  },
  logoutText: {
    color: '#D9FFF0',
    fontSize: 14,
    fontWeight: '800',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
  },
  emptyState: {
    borderColor: '#1D3B31',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    padding: 16,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  emptyText: {
    color: '#B7C8C0',
    fontSize: 14,
    lineHeight: 21,
  },
});
