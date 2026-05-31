import React, { useState } from 'react';
import { useSignIn } from '@clerk/expo/legacy';
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

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;
type AuthMode = 'login' | 'forgot-password' | 'reset-password';

export default function LoginScreen({ navigation }: Props) {
  const { isLoaded, signIn, setActive } = useSignIn();

  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin() {
    if (!isLoaded) {
      return;
    }

    if (!email.trim() || !password.trim()) {
      setError('Enter your email and password to continue.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password,
      });

      console.log('Clerk sign in result:', {
        status: result.status,
        supportedSecondFactors: (result as any).supportedSecondFactors,
        supportedFirstFactors: (result as any).supportedFirstFactors,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        return;
      }

      if (
        result.status === 'needs_second_factor' ||
        result.status === 'needs_client_trust'
      ) {
        setError(
          `Clerk is requesting additional verification. Status: ${result.status}. Since MFA is disabled in Clerk Dashboard, recreate this test user or check this user's security settings in Clerk.`,
        );
        return;
      }

      setError(`Login incomplete. Clerk status: ${result.status}`);
    } catch (err) {
      setError(getClerkErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSendResetCode() {
    if (!isLoaded) {
      return;
    }

    if (!email.trim()) {
      setError('Enter your email to receive a reset code.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier: email.trim(),
      });

      setResetCode('');
      setNewPassword('');
      setConfirmNewPassword('');
      setAuthMode('reset-password');
    } catch (err) {
      setError(getClerkErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword() {
    if (!isLoaded) {
      return;
    }

    if (
      !resetCode.trim() ||
      !newPassword.trim() ||
      !confirmNewPassword.trim()
    ) {
      setError('Enter the code and your new password.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: resetCode.trim(),
        password: newPassword,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        return;
      }

      if (result.status === 'needs_second_factor') {
        setError(
          'Password reset worked, but additional verification is required.',
        );
        return;
      }

      setError(`Password reset incomplete. Clerk status: ${result.status}`);
    } catch (err) {
      setError(getClerkErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  function showForgotPassword() {
    setAuthMode('forgot-password');
    setError('');
    setPassword('');
  }

  function showLogin() {
    setAuthMode('login');
    setError('');
    setResetCode('');
    setNewPassword('');
    setConfirmNewPassword('');
  }

  const title =
    authMode === 'login'
      ? 'Welcome back'
      : authMode === 'forgot-password'
        ? 'Reset password'
        : 'Create new password';

  const subtitle =
    authMode === 'login'
      ? 'Sign in to continue your AI-powered messaging workspace.'
      : authMode === 'forgot-password'
        ? 'Enter your account email and Clerk will send a password reset code.'
        : 'Enter the reset code from your email and choose a new password.';

  const primaryLabel = isSubmitting
    ? authMode === 'login'
      ? 'Signing in...'
      : authMode === 'forgot-password'
        ? 'Sending code...'
        : 'Updating password...'
    : authMode === 'login'
      ? 'Log in'
      : authMode === 'forgot-password'
        ? 'Send reset code'
        : 'Change password';

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

            <Text style={styles.title}>{title}</Text>

            <Text style={styles.subtitle}>{subtitle}</Text>

            <View style={styles.form}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor="#789185"
                style={styles.input}
                value={email}
              />

              {authMode === 'login' ? (
                <>
                  <TextInput
                    onChangeText={setPassword}
                    placeholder="Password"
                    placeholderTextColor="#789185"
                    secureTextEntry
                    style={styles.input}
                    value={password}
                  />

                  <Pressable
                    onPress={showForgotPassword}
                    style={({ pressed }) => [
                      styles.forgotButton,
                      pressed && styles.switchButtonPressed,
                    ]}
                  >
                    <Text style={styles.forgotText}>Forgot password?</Text>
                  </Pressable>
                </>
              ) : null}

              {authMode === 'reset-password' ? (
                <>
                  <TextInput
                    keyboardType="number-pad"
                    onChangeText={setResetCode}
                    placeholder="Reset code"
                    placeholderTextColor="#789185"
                    style={styles.input}
                    value={resetCode}
                  />

                  <TextInput
                    onChangeText={setNewPassword}
                    placeholder="New password"
                    placeholderTextColor="#789185"
                    secureTextEntry
                    style={styles.input}
                    value={newPassword}
                  />

                  <TextInput
                    onChangeText={setConfirmNewPassword}
                    placeholder="Confirm new password"
                    placeholderTextColor="#789185"
                    secureTextEntry
                    style={styles.input}
                    value={confirmNewPassword}
                  />
                </>
              ) : null}

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                activeOpacity={0.76}
                disabled={isSubmitting}
                onPress={
                  authMode === 'login'
                    ? handleLogin
                    : authMode === 'forgot-password'
                      ? handleSendResetCode
                      : handleResetPassword
                }
                style={[
                  styles.primaryButton,
                  isSubmitting && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
              </TouchableOpacity>
            </View>

            {authMode === 'login' ? (
              <Pressable
                onPress={() => navigation.navigate('Signup')}
                style={({ pressed }) => [
                  styles.switchButton,
                  pressed && styles.switchButtonPressed,
                ]}
              >
                <Text style={styles.switchText}>
                  New here?{' '}
                  <Text style={styles.switchAction}>Create account</Text>
                </Text>
              </Pressable>
            ) : (
              <View style={styles.resetLinks}>
                {authMode === 'reset-password' ? (
                  <Pressable
                    onPress={handleSendResetCode}
                    style={({ pressed }) => [
                      styles.switchButton,
                      pressed && styles.switchButtonPressed,
                    ]}
                  >
                    <Text style={styles.switchText}>
                      Didn't get a code?{' '}
                      <Text style={styles.switchAction}>Send again</Text>
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={showLogin}
                  style={({ pressed }) => [
                    styles.switchButton,
                    pressed && styles.switchButtonPressed,
                  ]}
                >
                  <Text style={styles.switchText}>
                    Remembered it?{' '}
                    <Text style={styles.switchAction}>Log in</Text>
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function getClerkErrorMessage(err: unknown) {
  if (
    typeof err === 'object' &&
    err !== null &&
    'errors' in err &&
    Array.isArray((err as { errors?: unknown }).errors)
  ) {
    const [firstError] = (err as { errors: Array<{ message?: string }> })
      .errors;

    return firstError?.message ?? 'Unable to sign in.';
  }

  if (err instanceof Error) {
    return err.message;
  }

  return 'Unable to sign in.';
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
  forgotButton: {
    alignSelf: 'flex-end',
    paddingBottom: 2,
    paddingHorizontal: 2,
  },
  forgotText: {
    color: '#D9FFF0',
    fontSize: 14,
    fontWeight: '800',
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
  resetLinks: {
    marginTop: 12,
  },
});
