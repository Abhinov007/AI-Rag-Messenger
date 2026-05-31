import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import {
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { AppStackParamList } from '../navigation/types';

type Props = {
  navigation: NativeStackNavigationProp<AppStackParamList, 'Settings'>;
};

export default function SettingsScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.backText}>{'< Back'}</Text>
        </Pressable>

        <Text style={styles.title}>Settings</Text>
      </View>

      <View style={styles.content}>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('LocalAISettings')}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowTitle}>Local AI</Text>
            <Text style={styles.rowSubtitle}>
              Download, delete, and test the on-device model.
            </Text>
          </View>

          <Text style={styles.chevron}>{'>'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#071A14',
  },
  header: {
    borderBottomColor: '#1D3B31',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  buttonPressed: {
    opacity: 0.68,
  },
  backText: {
    color: '#25D366',
    fontSize: 16,
    fontWeight: '800',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '900',
    marginTop: 12,
  },
  content: {
    padding: 16,
  },
  row: {
    alignItems: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  rowPressed: {
    opacity: 0.78,
  },
  rowTextWrap: {
    flex: 1,
  },
  rowTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  rowSubtitle: {
    color: '#A6BBB1',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  chevron: {
    color: '#25D366',
    fontSize: 22,
    fontWeight: '900',
  },
});
