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

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'> & {
  onLogin: (
    email: string,
    password: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export default function LoginScreen({ navigation, onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError('Enter your email and password to continue.');
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const result = await onLogin(email, password);
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
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>AI</Text>
            </View>

            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>
              Sign in to continue your AI-powered messaging workspace.
            </Text>
            <Text style={styles.helperText}>
              Demo: demo@airag.app / password123
            </Text>

            <View style={styles.form}>
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

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                activeOpacity={0.76}
                disabled={isSubmitting}
                onPress={handleLogin}
                style={[
                  styles.primaryButton,
                  isSubmitting && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {isSubmitting ? 'Signing in...' : 'Log in'}
                </Text>
              </TouchableOpacity>
            </View>

            <Pressable
              onPress={() => navigation.navigate('Signup')}
              style={({ pressed }) => [
                styles.switchButton,
                pressed && styles.switchButtonPressed,
              ]}
            >
              <Text style={styles.switchText}>
                New here? <Text style={styles.switchAction}>Create account</Text>
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
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logoText: {
    color: '#071A14',
    fontSize: 26,
    fontWeight: '900',
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
    marginBottom: 12,
  },
  helperText: {
    color: '#D9FFF0',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 24,
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
    marginTop: 24,
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
