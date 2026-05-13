import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../App';

type Props = NativeStackScreenProps<AuthStackParamList, 'Signup'> & {
  onSignup: (
    name: string,
    email: string,
    password: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export default function SignupScreen({ navigation, onSignup }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignup() {
    if (
      !name.trim() ||
      !email.trim() ||
      !password.trim() ||
      !confirmPassword.trim()
    ) {
      setError('Fill in all fields to create your account.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const result = await onSignup(name, email, password);
      if (!result.ok) {
        setError(result.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text style={styles.kicker}>AI RAG Chat</Text>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>
              Start with a lightweight local account flow. Real auth can plug in
              here later.
            </Text>

            <View style={styles.form}>
              <TextInput
                onChangeText={setName}
                placeholder="Name"
                placeholderTextColor="#789185"
                style={styles.input}
                value={name}
              />
              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor="#789185"
                style={styles.input}
                value={email}
              />
              <TextInput
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor="#789185"
                secureTextEntry
                style={styles.input}
                value={password}
              />
              <TextInput
                onChangeText={setConfirmPassword}
                placeholder="Confirm password"
                placeholderTextColor="#789185"
                secureTextEntry
                style={styles.input}
                value={confirmPassword}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                activeOpacity={0.76}
                disabled={isSubmitting}
                onPress={handleSignup}
                style={[
                  styles.primaryButton,
                  isSubmitting && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {isSubmitting ? 'Creating account...' : 'Sign up'}
                </Text>
              </TouchableOpacity>
            </View>

            <Pressable
              onPress={() => navigation.navigate('Login')}
              style={({ pressed }) => [
                styles.switchButton,
                pressed && styles.switchButtonPressed,
              ]}
            >
              <Text style={styles.switchText}>
                Already have an account?{' '}
                <Text style={styles.switchAction}>Log in</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#071A14',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  kicker: {
    color: '#25D366',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    marginBottom: 10,
  },
  subtitle: {
    color: '#B7C8C0',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 28,
  },
  form: {
    gap: 14,
  },
  input: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 8,
    borderWidth: 1,
    color: '#FFFFFF',
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  error: {
    color: '#FFB4A8',
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#25D366',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 54,
    marginTop: 4,
  },
  buttonPressed: {
    opacity: 0.72,
  },
  primaryButtonText: {
    color: '#071A14',
    fontSize: 16,
    fontWeight: '800',
  },
  switchButton: {
    alignItems: 'center',
    marginTop: 22,
    padding: 12,
  },
  switchButtonPressed: {
    opacity: 0.7,
  },
  switchText: {
    color: '#B7C8C0',
    fontSize: 15,
  },
  switchAction: {
    color: '#D9FFF0',
    fontWeight: '800',
  },
});
