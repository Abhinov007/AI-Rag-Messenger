import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import { initializeDatabase } from './src/db/database';
import {
  getCurrentUser,
  login,
  logout,
  signup,
} from './src/services/authStorage';

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

export type AppStackParamList = {
  ChatList: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitializingApp, setIsInitializingApp] = useState(true);

  useEffect(() => {
    async function prepareApp() {
      try {
        await initializeDatabase();
        const user = await getCurrentUser();
        setIsAuthenticated(Boolean(user));
      } finally {
        setIsInitializingApp(false);
      }
    }

    prepareApp();
  }, []);

  async function handleLogout() {
    await logout();
    setIsAuthenticated(false);
  }

  if (isInitializingApp) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#25D366" size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {isAuthenticated ? (
        <AppStack.Navigator screenOptions={{ headerShown: false }}>
          <AppStack.Screen name="ChatList">
            {(props) => (
              <ChatListScreen
                {...props}
                onLogout={handleLogout}
              />
            )}
          </AppStack.Screen>
        </AppStack.Navigator>
      ) : (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name="Login">
            {(props) => (
              <LoginScreen
                {...props}
                onLogin={async (email, password) => {
                  const result = await login(email, password);
                  if (result.ok) {
                    setIsAuthenticated(true);
                  }

                  return result;
                }}
              />
            )}
          </AuthStack.Screen>
          <AuthStack.Screen name="Signup">
            {(props) => (
              <SignupScreen
                {...props}
                onSignup={async (name, email, password) => {
                  const result = await signup(name, email, password);
                  if (result.ok) {
                    setIsAuthenticated(true);
                  }

                  return result;
                }}
              />
            )}
          </AuthStack.Screen>
        </AuthStack.Navigator>
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    alignItems: 'center',
    backgroundColor: '#071A14',
    flex: 1,
    justifyContent: 'center',
  },
});
