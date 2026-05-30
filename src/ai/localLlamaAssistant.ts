import * as FileSystem from 'expo-file-system/legacy';
import { initLlama } from 'llama.rn';

import type { Message } from '../types/message';

type LocalLlamaContext = Awaited<ReturnType<typeof initLlama>>;

const MODEL_FILE_NAME = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

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

const MAX_MESSAGES_FOR_SUMMARY = 12;
const MAX_MESSAGE_LENGTH = 220;

let contextPromise: Promise<LocalLlamaContext> | null = null;

function getModelPath(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('Local AI storage directory is unavailable.');
  }

  return `${FileSystem.documentDirectory}${MODEL_FILE_NAME}`;
}

async function getLocalLlamaContext(): Promise<LocalLlamaContext> {
  if (contextPromise) {
    return contextPromise;
  }

  contextPromise = (async () => {
    const modelPath = getModelPath();
    const fileInfo = await FileSystem.getInfoAsync(modelPath);

    if (!fileInfo.exists) {
      throw new Error(
        'Local AI model is not downloaded. Open the Local AI setup screen first.',
      );
    }

    return initLlama({
      model: modelPath,
      use_mlock: false,
      n_ctx: 1024,
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

function createRecentTranscript(title: string, messages: Message[]): string {
  return messages
    .slice(-MAX_MESSAGES_FOR_SUMMARY)
    .filter((message) => message.body.trim().length > 0)
    .map((message) => {
      const speaker = message.senderType === 'user' ? 'Me' : title;
      const body = message.body.trim().slice(0, MAX_MESSAGE_LENGTH);

      return `${speaker}: ${body}`;
    })
    .join('\n');
}

export async function summarizeRecentMessages(
  title: string,
  messages: Message[],
): Promise<string> {
  const transcript = createRecentTranscript(title, messages);

  if (!transcript) {
    return `There are no messages in this chat with ${title} to summarize yet.`;
  }

  const context = await getLocalLlamaContext();

  const result = await context.completion({
    messages: [
      {
        role: 'system',
        content:
          'You summarize private chat conversations. Use only the supplied conversation. Do not invent details. Keep the summary short and useful.',
      },
      {
        role: 'user',
        content: [
          `Summarize this recent chat with ${title}.`,
          '',
          'Requirements:',
          '- Write no more than 3 short bullet points.',
          '- Mention the main topic.',
          '- Mention a pending action only if one is clearly present.',
          '',
          'Conversation:',
          transcript,
        ].join('\n'),
      },
    ],
    n_predict: 120,
    temperature: 0.2,
    stop: STOP_WORDS,
  });

  const summary = result.text.trim();

  if (!summary) {
    throw new Error('The local model returned an empty summary.');
  }

  return summary;
}