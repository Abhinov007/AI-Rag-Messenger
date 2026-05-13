/**
 * Chat list screen.
 *
 * After authentication, this screen renders the conversation list from local
 * SQLite storage initialized by the app root.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ConversationItem from '../components/ConversationItem';
import { listConversations } from '../db/conversationRepository';
import type { AppStackParamList } from '../navigation/types';
import type { ConversationListItem } from '../types/conversation';

type Props = {
  onLogout: () => void;
};

/**
 * Displays locally stored conversations and exposes a temporary logout action.
 */
export default function ChatListScreen({ onLogout }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredConversations = conversations.filter((conversation) => {
    if (!normalizedSearchQuery) {
      return true;
    }

    const title = conversation.title?.toLowerCase() ?? '';
    const lastMessage = conversation.lastMessage?.toLowerCase() ?? '';

    return (
      title.includes(normalizedSearchQuery) ||
      lastMessage.includes(normalizedSearchQuery)
    );
  });

  const isFirstListFocus = useRef(true);

  const handleOpenConversation = useCallback(
    (conversation: ConversationListItem) => {
      Keyboard.dismiss();
      navigation.navigate('Chat', {
        conversationId: conversation.id,
        title: conversation.title,
      });
    },
    [navigation],
  );

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function loadConversations() {
        if (isFirstListFocus.current) {
          setIsLoading(true);
        }
        try {
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
            isFirstListFocus.current = false;
          }
        }
      }

      loadConversations();

      return () => {
        isMounted = false;
      };
    }, []),
  );

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

      <View style={styles.searchWrap}>
        <TextInput
          autoCapitalize="none"
          onChangeText={setSearchQuery}
          placeholder="Search chats"
          placeholderTextColor="#789185"
          style={styles.searchInput}
          value={searchQuery}
        />
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={filteredConversations}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <ConversationItem
            conversation={item}
            onPress={() => handleOpenConversation(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {isLoading ? (
              <ActivityIndicator color="#25D366" />
            ) : (
              <>
                <Text style={styles.emptyTitle}>
                  {error ||
                    (normalizedSearchQuery
                      ? 'No matching conversations'
                      : 'No conversations yet')}
                </Text>
                <Text style={styles.emptyText}>
                  {normalizedSearchQuery
                    ? 'Try searching by conversation name or last message.'
                    : 'New chats will appear here after they are created.'}
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
  searchWrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  searchInput: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 8,
    borderWidth: 1,
    color: '#FFFFFF',
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 14,
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
