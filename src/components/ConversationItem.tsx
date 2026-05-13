/**
 * Chat-list row for one conversation.
 *
 * Shows the avatar initial, conversation name, last-message preview, timestamp,
 * and an optional unread badge placeholder for the later unread-count feature.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ConversationListItem } from '../types/conversation';

type Props = {
  conversation: ConversationListItem;
  unreadCount?: number;
  onPress?: () => void;
};

export default function ConversationItem({
  conversation,
  unreadCount = 0,
  onPress,
}: Props) {
  const title = conversation.title ?? 'Untitled conversation';
  const lastMessage = conversation.lastMessage ?? 'No messages yet';
  const time = formatConversationTime(
    conversation.lastMessageAt ?? conversation.updatedAt,
  );

  return (
    <TouchableOpacity
      activeOpacity={0.76}
      onPress={onPress}
      style={styles.container}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{title.slice(0, 1).toUpperCase()}</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text numberOfLines={1} style={styles.name}>
            {title}
          </Text>
          <Text style={styles.time}>{time}</Text>
        </View>

        <View style={styles.previewRow}>
          <Text numberOfLines={1} style={styles.lastMessage}>
            {lastMessage}
          </Text>
          {unreadCount > 0 ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

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
    alignItems: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    marginBottom: 12,
    minHeight: 78,
    padding: 14,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#25D366',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarText: {
    color: '#071A14',
    fontSize: 18,
    fontWeight: '900',
  },
  content: {
    flex: 1,
    gap: 7,
    minWidth: 0,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  name: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
  },
  time: {
    color: '#8AA398',
    fontSize: 12,
    fontWeight: '700',
  },
  previewRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  lastMessage: {
    color: '#B7C8C0',
    flex: 1,
    fontSize: 14,
  },
  unreadBadge: {
    alignItems: 'center',
    backgroundColor: '#25D366',
    borderRadius: 10,
    justifyContent: 'center',
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  unreadText: {
    color: '#071A14',
    fontSize: 11,
    fontWeight: '900',
  },
});
