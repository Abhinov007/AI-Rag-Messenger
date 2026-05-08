import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import ChatListScreen from './src/screens/ChatListScreen';

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

  return (
    <NavigationContainer>
      {isAuthenticated ? (
        <AppStack.Navigator screenOptions={{ headerShown: false }}>
          <AppStack.Screen name="ChatList">
            {(props) => (
              <ChatListScreen
                {...props}
                onLogout={() => setIsAuthenticated(false)}
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
                onLoginSuccess={() => setIsAuthenticated(true)}
              />
            )}
          </AuthStack.Screen>
          <AuthStack.Screen name="Signup">
            {(props) => (
              <SignupScreen
                {...props}
                onSignupSuccess={() => setIsAuthenticated(true)}
              />
            )}
          </AuthStack.Screen>
        </AuthStack.Navigator>
      )}
    </NavigationContainer>
  );
}
