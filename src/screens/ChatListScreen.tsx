import React from 'react';
import {
  FlatList,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Props = {
  onLogout: () => void;
};

const chats = [
  {
    id: '1',
    name: 'Project Notes',
    preview: 'Local summaries and smart reply testing will live here.',
    time: 'Now',
  },
  {
    id: '2',
    name: 'Family',
    preview: 'Placeholder chat thread for the next messaging step.',
    time: '10:24',
  },
  {
    id: '3',
    name: 'Work',
    preview: 'RAG-backed search can surface older decisions here later.',
    time: 'Yesterday',
  },
];

export default function ChatListScreen({ onLogout }: Props) {
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
        data={chats}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable style={({ pressed }) => [styles.chatRow, pressed && styles.chatRowPressed]}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name.slice(0, 1)}</Text>
            </View>
            <View style={styles.chatBody}>
              <View style={styles.chatMeta}>
                <Text style={styles.chatName}>{item.name}</Text>
                <Text style={styles.chatTime}>{item.time}</Text>
              </View>
              <Text numberOfLines={1} style={styles.chatPreview}>
                {item.preview}
              </Text>
            </View>
          </Pressable>
        )}
        ListFooterComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Chat list placeholder ready</Text>
            <Text style={styles.emptyText}>
              Authentication now lands here. The real conversation list can
              replace these rows when message storage is added.
            </Text>
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
