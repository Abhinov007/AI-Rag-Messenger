import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  deleteLocalAiModel,
  downloadLocalAiModel,
  formatLocalAiBytes,
  getLocalAiModelInfo,
  getLocalLlamaContext,
  LOCAL_AI_MODEL_DISPLAY_SIZE,
  type LocalAiModelInfo,
} from '../ai/localAiModel';
import type { AppStackParamList } from '../navigation/types';

type Props = {
  navigation: NativeStackNavigationProp<AppStackParamList, 'LocalAISettings'>;
};

type ModelTask = 'checking' | 'downloading' | 'deleting' | 'testing' | null;

const STOP_WORDS = [
  '</s>',
  '<|end|>',
  '<|eot_id|>',
  '<|end_of_text|>',
  '<|im_end|>',
  '<|EOT|>',
  '<|END_OF_TURN_TOKEN|>',
  '<|end_of_turn|>',
  '<|endoftext|>',
];

export default function LocalAISettingsScreen({ navigation }: Props) {
  const [modelInfo, setModelInfo] = useState<LocalAiModelInfo | null>(null);
  const [task, setTask] = useState<ModelTask>('checking');
  const [status, setStatus] = useState('Checking local model storage...');
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [downloadText, setDownloadText] = useState('');
  const [testResponse, setTestResponse] = useState('');

  const isInstalled = modelInfo?.exists ?? false;
  const isBusy = task !== null;

  const refreshModelInfo = useCallback(async () => {
    const nextModelInfo = await getLocalAiModelInfo();

    setModelInfo(nextModelInfo);

    if (nextModelInfo.exists) {
      setStatus('Local AI model is installed on this phone.');
      setDownloadPercent(100);
      setDownloadText(
        nextModelInfo.sizeBytes
          ? `Stored model size: ${formatLocalAiBytes(nextModelInfo.sizeBytes)}`
          : '',
      );
    } else {
      setStatus('Local AI model is not installed yet.');
      setDownloadPercent(null);
      setDownloadText('');
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function checkModel() {
      try {
        await refreshModelInfo();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown storage error.';

        if (isMounted) {
          setStatus(message);
        }
      } finally {
        if (isMounted) {
          setTask(null);
        }
      }
    }

    checkModel();

    return () => {
      isMounted = false;
    };
  }, [refreshModelInfo]);

  async function handleDownloadModel() {
    try {
      setTask('downloading');
      setStatus('Downloading model to your phone. Keep the app open...');
      setDownloadPercent(0);
      setDownloadText('');
      setTestResponse('');

      const nextModelInfo = await downloadLocalAiModel((progress) => {
        if (progress.percent !== null) {
          setDownloadPercent(progress.percent);
        }

        if (progress.totalBytesExpectedToWrite > 0) {
          setDownloadText(
            `${formatLocalAiBytes(
              progress.totalBytesWritten,
            )} / ${formatLocalAiBytes(progress.totalBytesExpectedToWrite)}`,
          );
        } else {
          setDownloadText(
            `${formatLocalAiBytes(progress.totalBytesWritten)} downloaded`,
          );
        }
      });

      setModelInfo(nextModelInfo);
      setDownloadPercent(100);
      setDownloadText(
        nextModelInfo.sizeBytes
          ? `Stored model size: ${formatLocalAiBytes(nextModelInfo.sizeBytes)}`
          : 'Model downloaded.',
      );
      setStatus('Local AI model downloaded successfully.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown download error.';

      setStatus('Model download failed.');
      Alert.alert('Download failed', message);
      await refreshModelInfo();
    } finally {
      setTask(null);
    }
  }

  function handleDeleteModel() {
    Alert.alert(
      'Delete local model?',
      'This removes the model file from phone storage. You can download it again later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setTask('deleting');
              setStatus('Deleting local model...');
              setTestResponse('');

              await deleteLocalAiModel();
              await refreshModelInfo();
              setStatus('Local AI model was deleted from this phone.');
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : 'Unknown delete error.';

              setStatus('Could not delete the local model.');
              Alert.alert('Delete failed', message);
            } finally {
              setTask(null);
            }
          },
        },
      ],
    );
  }

  async function handleTestLocalAi() {
    if (!isInstalled) {
      Alert.alert(
        'Model not installed',
        'Download the Local AI model before testing it.',
      );
      return;
    }

    try {
      setTask('testing');
      setStatus('Testing local AI on this phone...');
      setTestResponse('');

      const context = await getLocalLlamaContext();
      let streamedText = '';

      const result = await context.completion(
        {
          messages: [
            {
              role: 'system',
              content:
                'You are a helpful assistant inside an offline mobile messaging application. Answer briefly.',
            },
            {
              role: 'user',
              content:
                'Reply with one short sentence confirming that local AI generation is working on this phone.',
            },
          ],
          n_predict: 48,
          temperature: 0.3,
          stop: STOP_WORDS,
        },
        (data) => {
          if (typeof data.token === 'string') {
            streamedText += data.token;
            setTestResponse(streamedText);
          }
        },
      );

      setTestResponse(result.text.trim() || streamedText.trim());
      setStatus('Local AI test completed successfully.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown test error.';

      setStatus('Local AI test failed.');
      Alert.alert('Test failed', message);
    } finally {
      setTask(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />

      <ScrollView contentContainerStyle={styles.container}>
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

        <Text style={styles.kicker}>Settings</Text>
        <Text style={styles.title}>Local AI</Text>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Model</Text>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Local AI model</Text>
            <Text
              style={[
                styles.statusValue,
                isInstalled ? styles.installed : styles.notInstalled,
              ]}
            >
              {isInstalled ? 'Installed' : 'Not installed'}
            </Text>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Model size</Text>
            <Text style={styles.statusValue}>
              {LOCAL_AI_MODEL_DISPLAY_SIZE}
            </Text>
          </View>

          <Text style={styles.statusText}>{status}</Text>

          {downloadPercent !== null ? (
            <View style={styles.progressContainer}>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${downloadPercent}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>
                {downloadPercent}% {downloadText}
              </Text>
            </View>
          ) : null}

          {isBusy ? (
            <ActivityIndicator color="#25D366" style={styles.loader} />
          ) : null}
        </View>

        <ActionButton
          disabled={isBusy || isInstalled}
          label="Download Model"
          onPress={handleDownloadModel}
        />

        <ActionButton
          disabled={isBusy || !isInstalled}
          label="Delete Model"
          onPress={handleDeleteModel}
          variant="danger"
        />

        <ActionButton
          disabled={isBusy || !isInstalled}
          label="Test Local AI"
          onPress={handleTestLocalAi}
        />

        {testResponse ? (
          <View style={styles.responseCard}>
            <Text style={styles.sectionLabel}>Test response</Text>
            <Text style={styles.responseText}>{testResponse}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

type ActionButtonProps = {
  disabled: boolean;
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'danger';
};

function ActionButton({
  disabled,
  label,
  onPress,
  variant = 'primary',
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        variant === 'danger' && styles.dangerButton,
        disabled && styles.actionButtonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text
        style={[
          styles.actionButtonText,
          variant === 'danger' && styles.dangerButtonText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#071A14',
  },
  container: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 30,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  buttonPressed: {
    opacity: 0.72,
  },
  backText: {
    color: '#25D366',
    fontSize: 16,
    fontWeight: '800',
  },
  kicker: {
    color: '#22C55E',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 12,
    textTransform: 'uppercase',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    marginTop: 4,
    marginBottom: 18,
  },
  card: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  sectionLabel: {
    color: '#8AA398',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  statusLabel: {
    color: '#B7C8C0',
    fontSize: 14,
    fontWeight: '700',
  },
  statusValue: {
    color: '#FFFFFF',
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'right',
  },
  installed: {
    color: '#86EFAC',
  },
  notInstalled: {
    color: '#FDBA74',
  },
  statusText: {
    color: '#E8F5EF',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  progressContainer: {
    marginTop: 16,
  },
  progressTrack: {
    backgroundColor: '#071A14',
    borderRadius: 999,
    height: 10,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#25D366',
    borderRadius: 999,
    height: 10,
  },
  progressText: {
    color: '#A6BBB1',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  loader: {
    marginTop: 16,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: '#25D366',
    borderRadius: 8,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dangerButton: {
    backgroundColor: '#3A1717',
    borderColor: '#7F1D1D',
    borderWidth: 1,
  },
  actionButtonDisabled: {
    opacity: 0.42,
  },
  actionButtonText: {
    color: '#071A14',
    fontSize: 15,
    fontWeight: '900',
  },
  dangerButtonText: {
    color: '#FECACA',
  },
  responseCard: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    padding: 16,
  },
  responseText: {
    color: '#E8F5EF',
    fontSize: 15,
    lineHeight: 22,
  },
});
