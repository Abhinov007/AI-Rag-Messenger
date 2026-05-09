/**
 * Chat list screen.
 *
 * After authentication, this screen seeds starter conversations if needed and
 * renders the conversation list from local SQLite storage.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { listConversations } from '../db/conversationRepository';
import { seedStarterConversations } from '../db/seed';
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
        await seedStarterConversations();
        const rows = await listConversations();

        if (isMounted) {
          setConversations(rows);
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
          <Pressable style={({ pressed }) => [styles.chatRow, pressed && styles.chatRowPressed]}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(item.title ?? 'C').slice(0, 1)}
              </Text>
            </View>
            <View style={styles.chatBody}>
              <View style={styles.chatMeta}>
                <Text style={styles.chatName}>
                  {item.title ?? 'Untitled conversation'}
                </Text>
                <Text style={styles.chatTime}>
                  {formatConversationTime(item.lastMessageAt ?? item.updatedAt)}
                </Text>
              </View>
              <Text numberOfLines={1} style={styles.chatPreview}>
                {item.lastMessage ?? 'No messages yet'}
              </Text>
            </View>
          </Pressable>
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
        ListFooterComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>SQLite conversations ready</Text>
            <Text style={styles.emptyText}>
              This list is now loaded from local conversation and message
              tables.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

/**
 * Formats SQLite timestamp strings for compact chat-list metadata.
 */
function formatConversationTime(value: string) {
  const date = new Date(value.replace(' ', 'T'));

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
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
    paddingTop: 18,
    paddingBottom: 14,
  },
  kicker: {
    color: '#25D366',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 32,
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
    padding: 16,
    paddingBottom: 28,
  },
  chatRow: {
    alignItems: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    marginBottom: 12,
    padding: 14,
  },
  chatRowPressed: {
    opacity: 0.76,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#25D366',
    borderRadius: 23,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  avatarText: {
    color: '#071A14',
    fontSize: 18,
    fontWeight: '900',
  },
  chatBody: {
    flex: 1,
    gap: 6,
  },
  chatMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  chatName: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
  },
  chatTime: {
    color: '#8AA398',
    fontSize: 12,
    fontWeight: '700',
  },
  chatPreview: {
    color: '#B7C8C0',
    fontSize: 14,
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
