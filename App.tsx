import './global.css';
import React, { useEffect, useState } from 'react';
import { ClerkProvider, useAuth, useClerk } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, Text, View } from 'react-native';
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ChatScreen from './src/screens/ChatScreen';
import type { AppStackParamList } from './src/navigation/types';
import { initializeDatabase } from './src/db/database';

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

export type { AppStackParamList } from './src/navigation/types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function App() {
  if (!publishableKey) {
    return (
      <View className="flex-1 items-center justify-center bg-[#071A14] px-6">
        <Text className="text-center text-base font-bold text-white">
          Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to your environment.
        </Text>
      </View>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <AppContent />
    </ClerkProvider>
  );
}

function AppContent() {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [isInitializingApp, setIsInitializingApp] = useState(true);

  useEffect(() => {
    async function prepareApp() {
      try {
        await initializeDatabase();
      } finally {
        setIsInitializingApp(false);
      }
    }

    prepareApp();
  }, []);

  async function handleLogout() {
    await signOut();
  }

  if (isInitializingApp || !isLoaded) {
    return (
      <View className="flex-1 items-center justify-center bg-[#071A14]">
        <ActivityIndicator color="#25D366" size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer>
        {isSignedIn ? (
          <AppStack.Navigator
            initialRouteName="ChatList"
            screenOptions={{ headerShown: false }}
          >
            <AppStack.Screen name="ChatList">
              {() => <ChatListScreen onLogout={handleLogout} />}
            </AppStack.Screen>
            <AppStack.Screen name="Chat" component={ChatScreen} />
          </AppStack.Navigator>
        ) : (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name="Login" component={LoginScreen} />
          <AuthStack.Screen name="Signup" component={SignupScreen} />
        </AuthStack.Navigator>
        )}
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
