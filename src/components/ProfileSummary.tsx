import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useUser } from '@clerk/expo';

function getInitials(name?: string | null, email?: string | null) {
  if (name?.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  }

  if (email?.trim()) {
    return email.trim()[0]?.toUpperCase() ?? 'U';
  }

  return 'U';
}

export default function ProfileSummary() {
  const { user } = useUser();
  const [isNameVisible, setIsNameVisible] = React.useState(false);

  const name =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split('@')[0] ||
    'User';

  const email = user?.primaryEmailAddress?.emailAddress ?? 'No email found';

  const avatarUrl = user?.imageUrl;
  const initials = getInitials(name, email);

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel="Show profile details"
        accessibilityRole="button"
        onPress={() => setIsNameVisible((visible) => !visible)}
        style={({ pressed }) => [
          styles.profileButton,
          pressed && styles.profileButtonPressed,
        ]}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
      </Pressable>

      {isNameVisible ? (
        <View style={styles.nameBubble}>
          <Text numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          <Text numberOfLines={1} style={styles.email}>
            {email}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    position: 'relative',
    zIndex: 10,
  },
  profileButton: {
    alignItems: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  profileButtonPressed: {
    opacity: 0.72,
  },
  nameBubble: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 8,
    borderWidth: 1,
    elevation: 6,
    position: 'absolute',
    right: 0,
    top: 52,
    width: 230,
    zIndex: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  avatar: {
    backgroundColor: '#1D3B31',
    borderRadius: 18,
    height: 36,
    width: 36,
  },
  avatarFallback: {
    alignItems: 'center',
    backgroundColor: '#22C55E',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  name: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  email: {
    color: '#B7C8C0',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
});
