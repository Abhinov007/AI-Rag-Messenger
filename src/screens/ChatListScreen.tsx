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
import { useAuth } from '@clerk/expo';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ProfileSummary from '../components/ProfileSummary';
import ConversationItem from '../components/ConversationItem';
import { listConversations } from '../db/conversationRepository';
import type { AppStackParamList } from '../navigation/types';
import { pullRemoteConversations } from '../services/conversationPull';
import type { ConversationListItem } from '../types/conversation';

type Props = {
  onLogout: () => void;
};

export default function ChatListScreen({ onLogout }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { userId, getToken } = useAuth();

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const isFirstListFocus = useRef(true);

  const getClerkToken = useCallback(async (): Promise<string | null> => {
    const token = await getToken({ template: 'supabase' });
    return typeof token === 'string' ? token : null;
  }, [getToken]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const filteredConversations = conversations.filter((conversation) => {
    if (!normalizedSearchQuery) {
      return true;
    }

    const title = conversation.title?.toLowerCase() ?? '';
    const lastMessage = conversation.lastMessage?.toLowerCase() ?? '';
    const contactEmail = conversation.contactEmail?.toLowerCase() ?? '';

    return (
      title.includes(normalizedSearchQuery) ||
      lastMessage.includes(normalizedSearchQuery) ||
      contactEmail.includes(normalizedSearchQuery)
    );
  });

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

  const handleAddContact = useCallback(() => {
    Keyboard.dismiss();
    navigation.navigate('AddContact');
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function loadConversations() {
        if (isFirstListFocus.current) {
          setIsLoading(true);
        }

        try {
          if (!userId) {
            if (isMounted) {
              setConversations([]);
              setError('');
            }

            return;
          }

          try {
            await pullRemoteConversations(userId, getClerkToken);
          } catch (pullError) {
            console.warn(
              'Remote conversation pull failed but local list will still load:',
              pullError,
            );
          }

          const rows = await listConversations(userId);

          console.log('ChatList conversations loaded:', {
            userId,
            count: rows.length,
            rows: rows.map((row) => ({
              id: row.id,
              title: row.title,
              remoteId: row.remoteId,
              ownerClerkUserId: row.ownerClerkUserId,
              contactClerkUserId: row.contactClerkUserId,
              contactEmail: row.contactEmail,
              lastMessage: row.lastMessage,
            })),
          });

          if (isMounted) {
            setConversations(rows);
            setError('');
          }
        } catch (error) {
          console.warn('Could not load conversations:', error);

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
    }, [userId, getClerkToken]),
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

      <ProfileSummary />

      <View style={styles.searchWrap}>
        <TextInput
          autoCapitalize="none"
          onChangeText={setSearchQuery}
          placeholder="Search chats or emails"
          placeholderTextColor="#789185"
          style={styles.searchInput}
          value={searchQuery}
        />
      </View>

      <View style={styles.actionsWrap}>
        <Pressable
          onPress={handleAddContact}
          style={({ pressed }) => [
            styles.addContactButton,
            pressed && styles.addContactButtonPressed,
          ]}
        >
          <Text style={styles.addContactIcon}>+</Text>
          <Text style={styles.addContactText}>Add Contact</Text>
        </Pressable>
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
              <ActivityIndicator color="#22C55E" />
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
                    ? 'Try searching by contact name, email, or last message.'
                    : 'Tap Add Contact to save an email and start a new chat.'}
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
    color: '#22C55E',
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
  actionsWrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  addContactButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#22C55E',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  addContactButtonPressed: {
    backgroundColor: '#16A34A',
    opacity: 0.9,
  },
  addContactIcon: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 22,
  },
  addContactText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
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