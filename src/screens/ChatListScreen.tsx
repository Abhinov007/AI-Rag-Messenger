/**
 * Chat list screen.
 *
 * After authentication, this screen renders the conversation list from local
 * SQLite storage initialized by the app root.
 *
 * Feature 3:
 * Users can save or change the display name of another person locally,
 * without changing the other user's actual profile name.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
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
import {
  getContactsForUser,
  normalizeEmail,
  renameContactLocally,
} from '../db/contactsRepository';
import { listConversations } from '../db/conversationRepository';
import type { AppStackParamList } from '../navigation/types';
import { pullRemoteConversations } from '../services/conversationPull';
import type { ConversationListItem } from '../types/conversation';
import type { Contact } from '../types/contacts';

type Props = {
  onLogout: () => void;
};

function applySavedContactNames(
  conversations: ConversationListItem[],
  contacts: Contact[],
): ConversationListItem[] {
  const savedNameByEmail = new Map<string, string>();

  contacts.forEach(contact => {
    savedNameByEmail.set(contact.normalizedEmail, contact.name);
  });

  return conversations.map(conversation => {
    if (!conversation.contactEmail) {
      return conversation;
    }

    const savedName = savedNameByEmail.get(
      normalizeEmail(conversation.contactEmail),
    );

    if (!savedName) {
      return conversation;
    }

    return {
      ...conversation,
      title: savedName,
    };
  });
}

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

  const [selectedConversation, setSelectedConversation] =
    useState<ConversationListItem | null>(null);
  const [isRenameModalVisible, setIsRenameModalVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isSavingRename, setIsSavingRename] = useState(false);

  const isFirstListFocus = useRef(true);
  const isLoadingConversationsRef = useRef(false);
  const lastRemotePullAtRef = useRef(0);
  const getTokenRef = useRef(getToken);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const filteredConversations = conversations.filter(conversation => {
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

  const handleOpenRenameModal = useCallback(
    (conversation: ConversationListItem) => {
      Keyboard.dismiss();

      if (!conversation.contactEmail) {
        Alert.alert(
          'Rename unavailable',
          'This conversation does not have a saved email address.',
        );
        return;
      }

      setSelectedConversation(conversation);
      setRenameValue(conversation.title ?? '');
      setIsRenameModalVisible(true);
    },
    [],
  );

  const handleCloseRenameModal = useCallback(() => {
    if (isSavingRename) {
      return;
    }

    Keyboard.dismiss();
    setIsRenameModalVisible(false);
    setSelectedConversation(null);
    setRenameValue('');
  }, [isSavingRename]);

  const handleSaveRename = async () => {
    if (!userId || !selectedConversation?.contactEmail) {
      return;
    }

    const savedName = renameValue.trim();

    if (!savedName) {
      Alert.alert('Name required', 'Enter a name for this contact.');
      return;
    }

    try {
      setIsSavingRename(true);

      await renameContactLocally(
        userId,
        selectedConversation.contactEmail,
        savedName,
      );

      setConversations(currentConversations =>
        currentConversations.map(conversation =>
          conversation.id === selectedConversation.id
            ? {
                ...conversation,
                title: savedName,
              }
            : conversation,
        ),
      );

      Keyboard.dismiss();
      setIsRenameModalVisible(false);
      setSelectedConversation(null);
      setRenameValue('');

      Alert.alert('Saved', 'Contact name updated successfully.');
    } catch (renameError) {
      console.error('Failed to rename saved contact:', renameError);

      Alert.alert(
        'Rename failed',
        renameError instanceof Error
          ? renameError.message
          : 'Unable to save the contact name.',
      );
    } finally {
      setIsSavingRename(false);
    }
  };

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

          const [conversationRows, savedContacts] = await Promise.all([
            listConversations(userId),
            getContactsForUser(userId),
          ]);

          const displayConversations = applySavedContactNames(
            conversationRows,
            savedContacts,
          );

          console.log('ChatList conversations loaded:', {
            userId,
            count: displayConversations.length,
          });

          if (isMounted) {
            setConversations(displayConversations);
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

      void loadConversations();

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
            accessibilityRole="button"
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
        keyExtractor={item => String(item.id)}
        renderItem={({ item }) => (
          <View style={styles.conversationRow}>
            <View style={styles.conversationItemWrap}>
              <ConversationItem
                conversation={item}
                onPress={() => handleOpenConversation(item)}
              />
            </View>

            <Pressable
              accessibilityLabel={`Rename ${
                item.title ?? item.contactEmail ?? 'contact'
              }`}
              accessibilityRole="button"
              onPress={() => handleOpenRenameModal(item)}
              style={({ pressed }) => [
                styles.renameButton,
                pressed && styles.renameButtonPressed,
              ]}
            >
              <Text style={styles.renameButtonIcon}>✎</Text>
            </Pressable>
          </View>
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

      <Modal
        animationType="fade"
        onRequestClose={handleCloseRenameModal}
        transparent
        visible={isRenameModalVisible}
      >
        <Pressable
          onPress={handleCloseRenameModal}
          style={styles.modalBackdrop}
        >
          <Pressable
            onPress={event => event.stopPropagation()}
            style={styles.renameCard}
          >
            <Text style={styles.renameTitle}>Save contact name</Text>

            <Text style={styles.renameSubtitle}>
              This name is private and visible only to you.
            </Text>

            {selectedConversation?.contactEmail ? (
              <Text style={styles.renameEmail}>
                {selectedConversation.contactEmail}
              </Text>
            ) : null}

            <TextInput
              autoFocus
              editable={!isSavingRename}
              maxLength={60}
              onChangeText={setRenameValue}
              onSubmitEditing={() => void handleSaveRename()}
              placeholder="Enter contact name"
              placeholderTextColor="#789185"
              returnKeyType="done"
              style={styles.renameInput}
              value={renameValue}
            />

            <View style={styles.renameActions}>
              <Pressable
                accessibilityRole="button"
                disabled={isSavingRename}
                onPress={handleCloseRenameModal}
                style={({ pressed }) => [
                  styles.renameCancelButton,
                  pressed && styles.modalButtonPressed,
                ]}
              >
                <Text style={styles.renameCancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={isSavingRename}
                onPress={() => void handleSaveRename()}
                style={({ pressed }) => [
                  styles.renameSaveButton,
                  pressed && styles.modalButtonPressed,
                  isSavingRename && styles.renameSaveButtonDisabled,
                ]}
              >
                {isSavingRename ? (
                  <ActivityIndicator color="#071A14" size="small" />
                ) : (
                  <Text style={styles.renameSaveText}>Save</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  conversationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  conversationItemWrap: {
    flex: 1,
  },
  renameButton: {
    alignItems: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 10,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 44,
  },
  renameButtonPressed: {
    backgroundColor: '#19382E',
    opacity: 0.82,
  },
  renameButtonIcon: {
    color: '#25D366',
    fontSize: 23,
    fontWeight: '800',
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
  modalBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'flex-end',
    padding: 16,
  },
  renameCard: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 24,
    padding: 18,
  },
  renameTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
  },
  renameSubtitle: {
    color: '#A6BBB1',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  renameEmail: {
    color: '#25D366',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
  },
  renameInput: {
    backgroundColor: '#071A14',
    borderColor: '#1D3B31',
    borderRadius: 10,
    borderWidth: 1,
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 16,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  renameActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  renameCancelButton: {
    alignItems: 'center',
    borderColor: '#1D3B31',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 22,
  },
  renameCancelText: {
    color: '#D9FFF0',
    fontSize: 15,
    fontWeight: '800',
  },
  renameSaveButton: {
    alignItems: 'center',
    backgroundColor: '#25D366',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 90,
    paddingHorizontal: 22,
  },
  renameSaveButtonDisabled: {
    opacity: 0.6,
  },
  renameSaveText: {
    color: '#071A14',
    fontSize: 15,
    fontWeight: '900',
  },
  modalButtonPressed: {
    opacity: 0.7,
  },
});