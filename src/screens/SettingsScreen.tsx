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

import type { AppStackParamList } from '../navigation/types';
import {
  downloadLocalAiModel,
  formatLocalAiBytes,
  getLocalAiModelInfo,
  LOCAL_AI_MODEL_DISPLAY_SIZE,
  LOCAL_AI_MODEL_FILE_NAME,
  type LocalAiDownloadProgress,
  type LocalAiModelInfo,
} from '../ai/localAiModel';

type Props = {
  navigation: NativeStackNavigationProp<AppStackParamList, 'Settings'>;
};

type DownloadState = 'checking' | 'idle' | 'downloading' | 'downloaded' | 'error';

export default function SettingsScreen({ navigation }: Props) {
  const [modelInfo, setModelInfo] = useState<LocalAiModelInfo | null>(null);
  const [downloadState, setDownloadState] =
    useState<DownloadState>('checking');
  const [downloadProgress, setDownloadProgress] =
    useState<LocalAiDownloadProgress | null>(null);

  const checkInstalledModel = useCallback(async () => {
    try {
      const info = await getLocalAiModelInfo();

      setModelInfo(info);
      setDownloadState(info.exists ? 'downloaded' : 'idle');
    } catch (error) {
      console.error('Unable to check local AI model:', error);
      setDownloadState('idle');
    }
  }, []);

  useEffect(() => {
    void checkInstalledModel();
  }, [checkInstalledModel]);

  const handleDownloadModel = async () => {
    try {
      setDownloadState('downloading');
      setDownloadProgress(null);

      const downloadedInfo = await downloadLocalAiModel(progress => {
        setDownloadProgress(progress);
      });

      setModelInfo(downloadedInfo);
      setDownloadState('downloaded');

      Alert.alert(
        'Download complete',
        'Llama is now installed and ready for offline AI features.',
      );
    } catch (error) {
      console.error('Local AI model download failed:', error);

      setDownloadState('error');

      Alert.alert(
        'Download failed',
        error instanceof Error
          ? error.message
          : 'Unable to download the Llama model.',
      );
    }
  };

  const isChecking = downloadState === 'checking';
  const isDownloading = downloadState === 'downloading';
  const isDownloaded = downloadState === 'downloaded';
  const percent = downloadProgress?.percent ?? 0;

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

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>LOCAL AI</Text>

        <View style={styles.modelCard}>
          <View style={styles.modelTopRow}>
            <View style={styles.modelTextContainer}>
              <Text style={styles.modelTitle}>Llama 3.2 1B</Text>

              <Text style={styles.modelSubtitle}>
                Run AI summaries locally on your phone without sending message
                content to a remote model.
              </Text>
            </View>

            {isDownloaded ? (
              <View style={styles.readyBadge}>
                <Text style={styles.readyBadgeText}>READY</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.modelDetails}>
            <Text style={styles.modelFileName}>{LOCAL_AI_MODEL_FILE_NAME}</Text>

            <Text style={styles.modelSize}>
              {modelInfo?.sizeBytes
                ? formatLocalAiBytes(modelInfo.sizeBytes)
                : LOCAL_AI_MODEL_DISPLAY_SIZE}
            </Text>
          </View>

          {isDownloading ? (
            <View style={styles.progressContainer}>
              <View style={styles.progressTextRow}>
                <Text style={styles.progressLabel}>
                  Downloading Llama model...
                </Text>

                <Text style={styles.progressPercent}>
                  {downloadProgress?.percent === null ||
                  downloadProgress?.percent === undefined
                    ? '--'
                    : `${downloadProgress.percent}%`}
                </Text>
              </View>

              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${percent}%`,
                    },
                  ]}
                />
              </View>

              {downloadProgress ? (
                <Text style={styles.downloadedBytes}>
                  {formatLocalAiBytes(downloadProgress.totalBytesWritten)}
                  {downloadProgress.totalBytesExpectedToWrite > 0
                    ? ` / ${formatLocalAiBytes(
                        downloadProgress.totalBytesExpectedToWrite,
                      )}`
                    : ''}
                </Text>
              ) : null}
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Download local Llama AI model"
            disabled={isChecking || isDownloading || isDownloaded}
            onPress={() => void handleDownloadModel()}
            style={({ pressed }) => [
              styles.downloadButton,
              isDownloaded && styles.downloadedButton,
              isChecking && styles.disabledButton,
              pressed &&
                !isDownloading &&
                !isDownloaded &&
                styles.buttonPressed,
            ]}
          >
            {isChecking ? (
              <ActivityIndicator color="#071A14" size="small" />
            ) : isDownloading ? (
              <View style={styles.buttonRow}>
                <ActivityIndicator color="#071A14" size="small" />
                <Text style={styles.downloadButtonText}>Downloading...</Text>
              </View>
            ) : isDownloaded ? (
              <Text style={styles.downloadedButtonText}>
                Model Downloaded
              </Text>
            ) : (
              <Text style={styles.downloadButtonText}>
                Download Llama Model
              </Text>
            )}
          </Pressable>

          {downloadState === 'error' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleDownloadModel()}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.retryButtonText}>Retry Download</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('LocalAISettings')}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowTitle}>Manage Local AI</Text>
            <Text style={styles.rowSubtitle}>
              Test the downloaded model or remove it from your device.
            </Text>
          </View>

          <Text style={styles.chevron}>{'>'}</Text>
        </Pressable>
      </ScrollView>
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
    paddingBottom: 32,
  },
  sectionTitle: {
    color: '#7F978C',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  modelCard: {
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    padding: 16,
  },
  modelTopRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  modelTextContainer: {
    flex: 1,
  },
  modelTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  modelSubtitle: {
    color: '#A6BBB1',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  readyBadge: {
    backgroundColor: '#163929',
    borderColor: '#25D366',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  readyBadgeText: {
    color: '#25D366',
    fontSize: 11,
    fontWeight: '900',
  },
  modelDetails: {
    backgroundColor: '#0A211A',
    borderRadius: 8,
    marginTop: 16,
    padding: 12,
  },
  modelFileName: {
    color: '#D7E3DE',
    fontSize: 12,
    fontWeight: '700',
  },
  modelSize: {
    color: '#7F978C',
    fontSize: 12,
    marginTop: 5,
  },
  progressContainer: {
    marginTop: 16,
  },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressLabel: {
    color: '#D7E3DE',
    fontSize: 12,
    fontWeight: '700',
  },
  progressPercent: {
    color: '#25D366',
    fontSize: 12,
    fontWeight: '900',
  },
  progressTrack: {
    backgroundColor: '#1D3B31',
    borderRadius: 99,
    height: 8,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#25D366',
    borderRadius: 99,
    height: 8,
  },
  downloadedBytes: {
    color: '#7F978C',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'right',
  },
  downloadButton: {
    alignItems: 'center',
    backgroundColor: '#25D366',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  disabledButton: {
    opacity: 0.6,
  },
  downloadedButton: {
    backgroundColor: '#173D2B',
    borderColor: '#25D366',
    borderWidth: 1,
  },
  buttonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  downloadButtonText: {
    color: '#071A14',
    fontSize: 16,
    fontWeight: '900',
  },
  downloadedButtonText: {
    color: '#25D366',
    fontSize: 16,
    fontWeight: '900',
  },
  retryButton: {
    alignItems: 'center',
    borderColor: '#25D366',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 13,
  },
  retryButtonText: {
    color: '#25D366',
    fontSize: 14,
    fontWeight: '800',
  },
  row: {
    alignItems: 'center',
    backgroundColor: '#102820',
    borderColor: '#1D3B31',
    borderRadius: 10,
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