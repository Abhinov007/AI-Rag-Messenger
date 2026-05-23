import { Image, StyleSheet, Text, View } from 'react-native';
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
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarInitials}>{initials}</Text>
        </View>
      )}

      <View style={styles.textWrap}>
        <Text numberOfLines={1} style={styles.name}>
          {name}
        </Text>

        <Text numberOfLines={1} style={styles.email}>
          {email}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    padding: 14,
  },
  avatar: {
    backgroundColor: '#1D3B31',
    borderRadius: 24,
    height: 48,
    width: 48,
  },
  avatarFallback: {
    alignItems: 'center',
    backgroundColor: '#22C55E',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  textWrap: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  email: {
    color: '#B7C8C0',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3,
  },
});