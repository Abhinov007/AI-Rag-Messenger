import { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { useAuth, useUser } from '@clerk/expo';

import {
  debugContactsForUser,
  isValidEmail,
  saveContactLocally,
} from '../db/contactsRepository';
import {
  createConversation,
  getConversationByContactEmail,
} from '../db/conversationRepository';
import { syncPendingConversations } from '../services/conversationSync';
import { findAppUserByEmail, normalizeEmail } from '../services/userDirectory';

export default function AddContactScreen({ navigation }: any) {
  const { userId, getToken } = useAuth();
  const { user } = useUser();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function getClerkToken(): Promise<string | null> {
    const token = await getToken({ template: 'supabase' });
    return typeof token === 'string' ? token : null;
  }

  async function handleSave() {
    if (isSaving) {
      return;
    }

    if (!userId) {
      Alert.alert('Not signed in', 'Please login before adding a contact.');
      return;
    }

    if (!name.trim()) {
      Alert.alert('Missing name', 'Please enter a contact name.');
      return;
    }

    if (!email.trim()) {
      Alert.alert('Missing email', 'Please enter an email address.');
      return;
    }

    if (!isValidEmail(email)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }

    const normalizedInputEmail = normalizeEmail(email);

    const ownEmail = user?.primaryEmailAddress?.emailAddress
      ? normalizeEmail(user.primaryEmailAddress.emailAddress)
      : null;

    if (ownEmail && normalizedInputEmail === ownEmail) {
      Alert.alert('Invalid contact', 'You cannot add your own email as a contact.');
      return;
    }

    try {
      setIsSaving(true);

      const existingUser = await findAppUserByEmail({
        email,
        getClerkToken,
      });

      if (!existingUser) {
        Alert.alert(
          'User does not exist',
          'No AIRagMessenger user was found with this email.',
        );
        return;
      }

      const existingConversation = await getConversationByContactEmail(
        existingUser.normalized_email,
      );

      if (existingConversation) {
        Alert.alert('Chat already exists', 'Opening existing chat.');

        navigation.replace('Chat', {
          conversationId: existingConversation.id,
          title: existingConversation.title,
        });

        return;
      }

      const contact = await saveContactLocally({
        clerkUserId: userId,
        name,
        email,
      });

      console.log('Contact saved locally:', contact);

      await debugContactsForUser(userId);

      const conversationId = await createConversation({
        title: name.trim(),
        contactName: name.trim(),
        contactEmail: existingUser.email,
        contactNormalizedEmail: existingUser.normalized_email,
        contactClerkUserId: existingUser.clerk_user_id,
      });

      await syncPendingConversations(userId, getClerkToken);

      Alert.alert('Contact added', 'User added to your chats.');

      navigation.replace('Chat', {
        conversationId,
        title: name.trim(),
      });
    } catch (error) {
      console.warn('Failed to check/add contact:', error);
      Alert.alert('Error', 'Could not check or add this user.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 20, backgroundColor: '#071A14' }}>
      <Text
        style={{
          color: '#FFFFFF',
          fontSize: 26,
          fontWeight: '800',
          marginBottom: 20,
        }}
      >
        Add Contact
      </Text>

      <Text style={{ color: '#D9FFF0', marginBottom: 6, fontWeight: '700' }}>
        Name
      </Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Enter name"
        placeholderTextColor="#789185"
        editable={!isSaving}
        style={{
          backgroundColor: '#102820',
          borderWidth: 1,
          borderColor: '#1D3B31',
          borderRadius: 12,
          color: '#FFFFFF',
          padding: 14,
          marginBottom: 16,
        }}
      />

      <Text style={{ color: '#D9FFF0', marginBottom: 6, fontWeight: '700' }}>
        Email
      </Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Enter email address"
        placeholderTextColor="#789185"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isSaving}
        style={{
          backgroundColor: '#102820',
          borderWidth: 1,
          borderColor: '#1D3B31',
          borderRadius: 12,
          color: '#FFFFFF',
          padding: 14,
          marginBottom: 24,
        }}
      />

      <Pressable
        onPress={handleSave}
        disabled={isSaving}
        style={({ pressed }) => ({
          backgroundColor: pressed ? '#16A34A' : '#22C55E',
          opacity: isSaving ? 0.7 : 1,
          padding: 16,
          borderRadius: 14,
          alignItems: 'center',
        })}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '900' }}>
          {isSaving ? 'Checking...' : 'Add to Chat'}
        </Text>
      </Pressable>
    </View>
  );
}