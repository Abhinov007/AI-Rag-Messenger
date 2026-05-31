/**
 * Chat list screen.
 *
 * After authentication, this screen renders the conversation list from local
 * SQLite storage initialized by the app root.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  const navigation =
    useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { userId, getToken } = useAuth();

  const [conversations, setConversations] = useState<ConversationListItem[]>(
    [],
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const isFirstListFocus = useRef(true);
  const isLoadingConversationsRef = useRef(false);
  const lastRemotePullAtRef = useRef(0);
  const getTokenRef = useRef(getToken);

  useEffect(() => {
    getTokenRef.current = getToken;
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

  const handleOpenSettings = useCallback(() => {
    Keyboard.dismiss();
    navigation.navigate('Settings');
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function loadConversations() {
        if (isLoadingConversationsRef.current) {
          return;
        }

        isLoadingConversationsRef.current = true;

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

          const now = Date.now();
          const shouldPullRemote = now - lastRemotePullAtRef.current > 5000;

          if (shouldPullRemote) {
            lastRemotePullAtRef.current = now;

            const getClerkToken = async (): Promise<string | null> => {
              const token = await getTokenRef.current({
                template: 'supabase',
              });

              return typeof token === 'string' ? token : null;
            };

            try {
              await pullRemoteConversations(userId, getClerkToken);
            } catch (pullError) {
              console.warn(
                'Remote conversation pull failed but local list will still load:',
                pullError,
              );
            }
          }

          const rows = await listConversations(userId);

          console.log('ChatList conversations loaded:', {
            userId,
            count: rows.length,
          });

          if (isMounted) {
            setConversations(rows);
            setError('');
          }
        } catch (loadError) {
          console.warn('Could not load conversations:', loadError);

          if (isMounted) {
            setError('Could not load conversations.');
          }
        } finally {
          isLoadingConversationsRef.current = false;

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
    }, [userId]),
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>AI RAG Chat</Text>
          <Text style={styles.title}>Chats</Text>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="Open settings"
            accessibilityRole="button"
            onPress={handleOpenSettings}
            style={({ pressed }) => [
              styles.settingsButton,
              pressed && styles.settingsButtonPressed,
            ]}
          >
            <Text style={styles.settingsIcon}>⚙</Text>
          </Pressable>

          <Pressable
            accessibilityLabel="Add contact"
            accessibilityRole="button"
            onPress={handleAddContact}
            style={({ pressed }) => [
              styles.addContactButton,
              pressed && styles.addContactButtonPressed,
            ]}
          >
            <Text style={styles.addContactIcon}>+</Text>
          </Pressable>

          <ProfileSummary />

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
      </View>

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
                    : 'Tap + to save an email and start a new chat.'}
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
    zIndex: 20,
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
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  logoutButton: {
    backgroundColor: '#BBF7D0',
    borderColor: '#86EFAC',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  logoutButtonPressed: {
    opacity: 0.68,
  },
  logoutText: {
    color: '#064E3B',
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
  addContactButton: {
    alignItems: 'center',
    backgroundColor: '#22C55E',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  addContactButtonPressed: {
    backgroundColor: '#16A34A',
    opacity: 0.9,
  },
  addContactIcon: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 28,
  },
  settingsButton: {
    alignItems: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  settingsButtonPressed: {
    opacity: 0.72,
  },
  settingsIcon: {
    color: '#D9FFF0',
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 24,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
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
