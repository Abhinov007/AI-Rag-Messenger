import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { initLlama } from 'llama.rn';

type LocalLlamaContext = Awaited<ReturnType<typeof initLlama>>;

type ModelState =
  | 'checking'
  | 'not-downloaded'
  | 'downloading'
  | 'downloaded'
  | 'loading'
  | 'loaded'
  | 'generating'
  | 'error';

const MODEL_FILE_NAME = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

const MODEL_URL =
  'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf?download=true';

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

function getModelPath(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('The app document directory is unavailable.');
  }

  return `${FileSystem.documentDirectory}${MODEL_FILE_NAME}`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LocalAITestScreen() {
  const contextRef = useRef<LocalLlamaContext | null>(null);

  const [modelState, setModelState] = useState<ModelState>('checking');
  const [status, setStatus] = useState('Checking local model storage...');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(
    null,
  );
  const [downloadText, setDownloadText] = useState('');
  const [response, setResponse] = useState('');
  const [timingText, setTimingText] = useState('');

  const busy =
    modelState === 'checking' ||
    modelState === 'downloading' ||
    modelState === 'loading' ||
    modelState === 'generating';

  useEffect(() => {
    async function checkExistingModel() {
      try {
        const modelPath = getModelPath();
        const fileInfo = await FileSystem.getInfoAsync(modelPath);

        if (fileInfo.exists) {
          setModelState('downloaded');
          setStatus('Model file is already stored on this phone.');
          setDownloadProgress(100);

          if ('size' in fileInfo && typeof fileInfo.size === 'number') {
            setDownloadText(`Stored model size: ${formatBytes(fileInfo.size)}`);
          }
        } else {
          setModelState('not-downloaded');
          setStatus('Model is not downloaded yet.');
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown storage error.';

        setModelState('error');
        setStatus(message);
      }
    }

    checkExistingModel();
  }, []);

  async function downloadModel() {
    try {
      const modelPath = getModelPath();

      setModelState('downloading');
      setStatus('Downloading model to your phone. Keep the app open...');
      setDownloadProgress(0);
      setDownloadText('');
      setResponse('');
      setTimingText('');

      const download = FileSystem.createDownloadResumable(
        MODEL_URL,
        modelPath,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          if (totalBytesExpectedToWrite <= 0) {
            setDownloadText(
              `${formatBytes(totalBytesWritten)} downloaded`,
            );
            return;
          }

          const percent = Math.round(
            (totalBytesWritten / totalBytesExpectedToWrite) * 100,
          );

          setDownloadProgress(percent);
          setDownloadText(
            `${formatBytes(totalBytesWritten)} / ${formatBytes(
              totalBytesExpectedToWrite,
            )}`,
          );
        },
      );

      const result = await download.downloadAsync();

      if (!result?.uri) {
        throw new Error('Model download completed without a local file path.');
      }

      const fileInfo = await FileSystem.getInfoAsync(modelPath);

      if (!fileInfo.exists) {
        throw new Error('Downloaded model file could not be found.');
      }

      setModelState('downloaded');
      setStatus('Model downloaded successfully. You can now load it.');
      setDownloadProgress(100);

      if ('size' in fileInfo && typeof fileInfo.size === 'number') {
        setDownloadText(`Stored model size: ${formatBytes(fileInfo.size)}`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown download error.';

      setModelState('error');
      setStatus('Model download failed.');
      Alert.alert('Download failed', message);
    }
  }

  async function loadModel() {
    try {
      if (contextRef.current) {
        setModelState('loaded');
        setStatus('Model is already loaded locally.');
        return;
      }

      const modelPath = getModelPath();
      const fileInfo = await FileSystem.getInfoAsync(modelPath);

      if (!fileInfo.exists) {
        Alert.alert('Model not found', 'Download the model first.');
        setModelState('not-downloaded');
        return;
      }

      setModelState('loading');
      setStatus('Loading the model into memory. This may take a moment...');
      setResponse('');
      setTimingText('');

      const startedAt = Date.now();

      const context = await initLlama({
        model: modelPath,
        use_mlock: false,
        n_ctx: 1024,
        n_batch: 128,
        n_threads: 4,
        n_gpu_layers: 0,
      });

      contextRef.current = context;

      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

      setModelState('loaded');
      setStatus('Model loaded locally. Ready to generate.');
      setTimingText(`Model load time: ${seconds}s`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown model load error.';

      setModelState('error');
      setStatus('Model failed to load.');
      Alert.alert('Load failed', message);
    }
  }

  async function generateTestResponse() {
    try {
      const context = contextRef.current;

      if (!context) {
        Alert.alert('Model not loaded', 'Load the model first.');
        return;
      }

      setModelState('generating');
      setStatus('Generating entirely on this phone...');
      setResponse('');
      setTimingText('');

      const startedAt = Date.now();
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
            setResponse(streamedText);
          }
        },
      );

      const finalText = result.text.trim() || streamedText.trim();
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

      setResponse(finalText);
      setTimingText(`Generation time: ${seconds}s`);
      setModelState('loaded');
      setStatus('Local generation completed successfully.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown generation error.';

      setModelState('error');
      setStatus('Generation failed.');
      Alert.alert('Generation failed', message);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.heading}>Local AI Test</Text>
        <Text style={styles.subheading}>
          Llama 3.2 1B running directly on your phone
        </Text>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Model status</Text>
          <Text style={styles.status}>{status}</Text>

          {downloadProgress !== null && (
            <View style={styles.progressContainer}>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${downloadProgress}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>
                {downloadProgress}% {downloadText}
              </Text>
            </View>
          )}

          {busy && <ActivityIndicator style={styles.loader} size="large" />}
        </View>

        <ActionButton
  label="1. Download Model"
  onPress={downloadModel}
  disabled={
    busy || modelState === 'downloaded' || modelState === 'loaded'
  }
/>

<ActionButton
  label="2. Load Model"
  onPress={loadModel}
  disabled={busy || modelState === 'not-downloaded'}
/>

<ActionButton
  label="3. Generate Test Response"
  onPress={generateTestResponse}
  disabled={busy || !contextRef.current}
/>

        {timingText.length > 0 && (
          <Text style={styles.timing}>{timingText}</Text>
        )}

        {response.length > 0 && (
          <View style={styles.responseCard}>
            <Text style={styles.sectionLabel}>Model response</Text>
            <Text style={styles.response}>{response}</Text>
          </View>
        )}

        <Text style={styles.note}>
          Download requires internet once. After the model is stored locally,
          generation can run without sending the prompt to a server.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

type ActionButtonProps = {
  label: string;
  disabled: boolean;
  onPress: () => void;
};

function ActionButton({ label, disabled, onPress }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 48,
  },
  heading: {
    color: '#111827',
    fontSize: 30,
    fontWeight: '700',
  },
  subheading: {
    color: '#6b7280',
    fontSize: 15,
    marginTop: 6,
    marginBottom: 26,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
  },
  sectionLabel: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  status: {
    color: '#111827',
    fontSize: 16,
    lineHeight: 23,
  },
  progressContainer: {
    marginTop: 18,
  },
  progressTrack: {
    backgroundColor: '#e5e7eb',
    borderRadius: 999,
    height: 9,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#2563eb',
    borderRadius: 999,
    height: 9,
  },
  progressText: {
    color: '#4b5563',
    fontSize: 13,
    marginTop: 8,
  },
  loader: {
    marginTop: 18,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 14,
    marginBottom: 12,
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  buttonDisabled: {
    backgroundColor: '#9ca3af',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  timing: {
    color: '#374151',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 6,
  },
  responseCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    marginTop: 14,
    padding: 18,
  },
  response: {
    color: '#111827',
    fontSize: 16,
    lineHeight: 25,
  },
  note: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 22,
  },
});