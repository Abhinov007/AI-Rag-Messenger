import React from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  StatusBar,
} from 'react-native';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.content}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>AI</Text>
        </View>

        <Text style={styles.title}>AI RAG Chat</Text>

        <Text style={styles.subtitle}>
          A privacy-first chat app with local AI summaries, smart replies, and chat-history RAG.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Day 1 Setup Complete</Text>

          <Text style={styles.cardText}>
            Expo is running successfully. The base project structure is ready.
            Next, we will build the login and signup flow.
          </Text>
        </View>

        <View style={styles.featureList}>
          <Text style={styles.feature}>✓ Incoming message summaries</Text>
          <Text style={styles.feature}>✓ Outgoing message rewrite</Text>
          <Text style={styles.feature}>✓ Chat-history RAG</Text>
          <Text style={styles.feature}>✓ Offline local AI planned</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#071A14',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoCircle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logoText: {
    color: '#071A14',
    fontSize: 28,
    fontWeight: '900',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    marginBottom: 12,
  },
  subtitle: {
    color: '#B7C8C0',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 28,
  },
  card: {
    backgroundColor: '#102820',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1D3B31',
    marginBottom: 22,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  cardText: {
    color: '#B7C8C0',
    fontSize: 14,
    lineHeight: 21,
  },
  featureList: {
    gap: 10,
  },
  feature: {
    color: '#D9FFF0',
    fontSize: 15,
    fontWeight: '500',
  },
});