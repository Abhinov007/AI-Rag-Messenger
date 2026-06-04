/**
 * Chat list and contacts screen.
 *
 * This screen shows saved contacts as conversations. Users can:
 * - open a chat
 * - rename a saved contact
 * - delete a saved contact and its local chat history
 */
import { useAuth } from '@clerk/expo';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import ConversationItem from '../components/ConversationItem';
import ProfileSummary from '../components/ProfileSummary';
import {
  deleteContactAndConversation,
  renameSavedContact,
} from '../db/contactsRepository';
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

  const [selectedConversation, setSelectedConversation] =
    useState<ConversationListItem | null>(null);

  const [isActionMenuVisible, setIsActionMenuVisible] = useState(false);
  const [isRenameModalVisible, setIsRenameModalVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isSavingRename, setIsSavingRename] = useState(false);

  const [deletingConversationId, setDeletingConversationId] = useState<
    ConversationListItem['id'] | null
  >(null);

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

  const handleOpenActions = useCallback(
    (conversation: ConversationListItem) => {
      Keyboard.dismiss();
      setSelectedConversation(conversation);
      setIsActionMenuVisible(true);
    },
    [],
  );

  const handleCloseActions = useCallback(() => {
    setIsActionMenuVisible(false);
    setSelectedConversation(null);
  }, []);

  const handleOpenRenameModal = useCallback(() => {
    if (!selectedConversation) {
      return;
    }

    setRenameValue(selectedConversation.title ?? '');
    setIsActionMenuVisible(false);
    setIsRenameModalVisible(true);
  }, [selectedConversation]);

  const handleCloseRenameModal = useCallback(() => {
    if (isSavingRename) {
      return;
    }

    Keyboard.dismiss();
    setIsRenameModalVisible(false);
    setRenameValue('');
    setSelectedConversation(null);
  }, [isSavingRename]);

  const handleSaveRename = async () => {
    const savedName = renameValue.trim();

    if (!userId || !selectedConversation) {
      return;
    }

    if (!savedName) {
      Alert.alert('Name required', 'Enter a name for this contact.');
      return;
    }

    if (!selectedConversation.contactEmail) {
      Alert.alert(
        'Rename failed',
        'This chat does not have a saved contact email.',
      );
      return;
    }

    try {
      setIsSavingRename(true);

      await renameSavedContact(
        userId,
        selectedConversation.contactEmail,
        selectedConversation.id,
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
      setRenameValue('');
      setSelectedConversation(null);
    } catch (renameError) {
      console.error('Failed to rename saved contact:', renameError);

      Alert.alert(
        'Rename failed',
        renameError instanceof Error
          ? renameError.message
          : 'Unable to save the new contact name. Please try again.',
      );
    } finally {
      setIsSavingRename(false);
    }
  };

  const handleDeleteContactAndChat = useCallback(() => {
    if (!userId || !selectedConversation) {
      return;
    }

    const conversationToDelete = selectedConversation;
    const contactEmail = conversationToDelete.contactEmail;
    const displayName =
      conversationToDelete.title ?? contactEmail ?? 'this contact';

    setIsActionMenuVisible(false);

    if (!contactEmail) {
      Alert.alert(
        'Delete failed',
        'This chat does not have a saved contact email.',
      );

      setSelectedConversation(null);
      return;
    }

    Alert.alert(
      'Delete contact and chat?',
      `This will remove ${displayName} from your contacts and delete your chat history with them from this device. It will not delete the other person's chat.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => setSelectedConversation(null),
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingConversationId(conversationToDelete.id);

              await deleteContactAndConversation(
                userId,
                contactEmail,
                conversationToDelete.id,
              );

              setConversations(currentConversations =>
                currentConversations.filter(
                  conversation => conversation.id !== conversationToDelete.id,
                ),
              );

              setSelectedConversation(null);
            } catch (deleteError) {
              console.error(
                'Failed to delete contact and conversation:',
                deleteError,
              );

              Alert.alert(
                'Delete failed',
                deleteError instanceof Error
                  ? deleteError.message
                  : 'Unable to delete this contact and chat. Please try again.',
              );
            } finally {
              setDeletingConversationId(null);
            }
          },
        },
      ],
    );
  }, [selectedConversation, userId]);

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
                'Remote conversation pull failed, loading local chats only:',
                pullError,
              );
            }
          }

          const rows = await listConversations(userId);

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
              pressed && styles.buttonPressed,
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
              pressed && styles.buttonPressed,
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
              pressed && styles.buttonPressed,
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
        renderItem={({ item }) => {
          const isDeleting = deletingConversationId === item.id;

          return (
            <View style={styles.conversationRow}>
              <View style={styles.conversationItemContainer}>
                <ConversationItem
                  conversation={item}
                  onPress={() => handleOpenConversation(item)}
                />
              </View>

              <Pressable
                accessibilityLabel={`Options for ${
                  item.title ?? item.contactEmail ?? 'contact'
                }`}
                accessibilityRole="button"
                disabled={isDeleting}
                onPress={() => handleOpenActions(item)}
                style={({ pressed }) => [
                  styles.moreButton,
                  pressed && styles.moreButtonPressed,
                  isDeleting && styles.disabledAction,
                ]}
              >
                {isDeleting ? (
                  <ActivityIndicator color="#25D366" size="small" />
                ) : (
                  <Text style={styles.moreButtonText}>⋮</Text>
                )}
              </Pressable>
            </View>
          );
        }}
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
        onRequestClose={handleCloseActions}
        transparent
        visible={isActionMenuVisible && selectedConversation !== null}
      >
        <Pressable
          onPress={handleCloseActions}
          style={styles.modalBackdrop}
        >
          <Pressable
            onPress={event => event.stopPropagation()}
            style={styles.actionSheet}
          >
            <Text style={styles.actionSheetTitle}>
              {selectedConversation?.title ??
                selectedConversation?.contactEmail ??
                'Contact'}
            </Text>

            {selectedConversation?.contactEmail ? (
              <Text style={styles.actionSheetSubtitle}>
                {selectedConversation.contactEmail}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={handleOpenRenameModal}
              style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.actionButtonPressed,
              ]}
            >
              <Text style={styles.actionButtonText}>Rename contact</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={handleDeleteContactAndChat}
              style={({ pressed }) => [
                styles.actionButton,
                styles.deleteActionButton,
                pressed && styles.actionButtonPressed,
              ]}
            >
              <Text style={styles.deleteActionText}>
                Delete contact and chat
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={handleCloseActions}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.actionButtonPressed,
              ]}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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
            <Text style={styles.renameTitle}>Rename contact</Text>

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
                  pressed && styles.actionButtonPressed,
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
                  pressed && styles.actionButtonPressed,
                  isSavingRename && styles.disabledAction,
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
    backgroundColor: '#071A14',
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
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
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  settingsButton: {
    alignItems: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 22,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  settingsIcon: {
    color: '#D9FFF0',
    fontSize: 20,
    fontWeight: '900',
  },
  addContactButton: {
    alignItems: 'center',
    backgroundColor: '#25D366',
    borderRadius: 22,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  addContactIcon: {
    color: '#071A14',
    fontSize: 27,
    fontWeight: '900',
    lineHeight: 29,
  },
  logoutButton: {
    backgroundColor: '#BBF7D0',
    borderColor: '#86EFAC',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  logoutText: {
    color: '#064E3B',
    fontSize: 13,
    fontWeight: '800',
  },
  buttonPressed: {
    opacity: 0.68,
  },
  searchWrap: {
    paddingBottom: 8,
    paddingHorizontal: 16,
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
    paddingBottom: 28,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  conversationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  conversationItemContainer: {
    flex: 1,
  },
  moreButton: {
    alignItems: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 10,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 42,
  },
  moreButtonPressed: {
    backgroundColor: '#173D30',
  },
  moreButtonText: {
    color: '#D9FFF0',
    fontSize: 25,
    fontWeight: '900',
    lineHeight: 26,
  },
  disabledAction: {
    opacity: 0.55,
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
  actionSheet: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  actionSheetTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '900',
  },
  actionSheetSubtitle: {
    color: '#A6BBB1',
    fontSize: 13,
    marginBottom: 18,
    marginTop: 4,
  },
  actionButton: {
    borderColor: '#1D3B31',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 15,
  },
  actionButtonPressed: {
    opacity: 0.7,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  deleteActionButton: {
    backgroundColor: '#311C1D',
    borderColor: '#6B2B31',
  },
  deleteActionText: {
    color: '#FCA5A5',
    fontSize: 15,
    fontWeight: '800',
  },
  cancelButton: {
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 12,
  },
  cancelButtonText: {
    color: '#A6BBB1',
    fontSize: 15,
    fontWeight: '800',
  },
  renameCard: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 40,
    padding: 18,
  },
  renameTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
  },
  renameEmail: {
    color: '#A6BBB1',
    fontSize: 13,
    marginTop: 5,
  },
  renameInput: {
    backgroundColor: '#071A14',
    borderColor: '#1D3B31',
    borderRadius: 10,
    borderWidth: 1,
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 18,
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
  renameSaveText: {
    color: '#071A14',
    fontSize: 15,
    fontWeight: '900',
  },
});