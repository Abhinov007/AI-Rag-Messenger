import * as FileSystem from 'expo-file-system/legacy';
import { initLlama, releaseAllLlama } from 'llama.rn';

type LocalLlamaContext = Awaited<ReturnType<typeof initLlama>>;

export type LocalAiModelInfo = {
  exists: boolean;
  path: string;
  sizeBytes: number | null;
};

export type LocalAiDownloadProgress = {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
  percent: number | null;
};

export const LOCAL_AI_MODEL_FILE_NAME = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';
export const LOCAL_AI_MODEL_DISPLAY_SIZE = '~808 MB';
export const LOCAL_AI_NOT_INSTALLED_MESSAGE =
  'Local AI model is not installed yet. Go to Settings -> Local AI to download it.';

const LOCAL_AI_MODEL_URL =
  'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf?download=true';

const MODEL_CONTEXT_SIZE = 2048;

let contextPromise: Promise<LocalLlamaContext> | null = null;

export function getLocalAiModelPath(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('Local AI storage directory is unavailable.');
  }

  return `${FileSystem.documentDirectory}${LOCAL_AI_MODEL_FILE_NAME}`;
}

export function formatLocalAiBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function getLocalAiModelInfo(): Promise<LocalAiModelInfo> {
  const path = getLocalAiModelPath();
  const fileInfo = await FileSystem.getInfoAsync(path);

  return {
    exists: fileInfo.exists,
    path,
    sizeBytes:
      fileInfo.exists && 'size' in fileInfo && typeof fileInfo.size === 'number'
        ? fileInfo.size
        : null,
  };
}

export async function isLocalAiModelInstalled(): Promise<boolean> {
  return (await getLocalAiModelInfo()).exists;
}

export async function downloadLocalAiModel(
  onProgress?: (progress: LocalAiDownloadProgress) => void,
): Promise<LocalAiModelInfo> {
  const existingInfo = await getLocalAiModelInfo();

  if (existingInfo.exists) {
    return existingInfo;
  }

  const download = FileSystem.createDownloadResumable(
    LOCAL_AI_MODEL_URL,
    existingInfo.path,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      onProgress?.({
        totalBytesWritten,
        totalBytesExpectedToWrite,
        percent:
          totalBytesExpectedToWrite > 0
            ? Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100)
            : null,
      });
    },
  );

  const result = await download.downloadAsync();

  if (!result?.uri) {
    throw new Error('Model download completed without a local file path.');
  }

  const downloadedInfo = await getLocalAiModelInfo();

  if (!downloadedInfo.exists) {
    throw new Error('Downloaded model file could not be found.');
  }

  return downloadedInfo;
}

export async function getLocalLlamaContext(): Promise<LocalLlamaContext> {
  if (contextPromise) {
    return contextPromise;
  }

  contextPromise = (async () => {
    const modelInfo = await getLocalAiModelInfo();

    if (!modelInfo.exists) {
      throw new Error(LOCAL_AI_NOT_INSTALLED_MESSAGE);
    }

    return initLlama({
      model: modelInfo.path,
      use_mlock: false,
      n_ctx: MODEL_CONTEXT_SIZE,
      n_batch: 128,
      n_threads: 4,
      n_gpu_layers: 0,
    });
  })().catch((error) => {
    contextPromise = null;
    throw error;
  });

  return contextPromise;
}

export async function releaseLocalAiModel(): Promise<void> {
  contextPromise = null;
  await releaseAllLlama();
}

export async function deleteLocalAiModel(): Promise<void> {
  const modelInfo = await getLocalAiModelInfo();

  if (!modelInfo.exists) {
    return;
  }

  await releaseLocalAiModel();
  await FileSystem.deleteAsync(modelInfo.path, { idempotent: true });
}
