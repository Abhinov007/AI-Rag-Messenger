import type { Message } from '../types/message';
import { getLocalLlamaContext } from './localAiModel';

export type ReplySuggestionResult = {
  suggestions: string[];
};

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

const MAX_MESSAGES_FOR_SUMMARY = 24;
const MAX_SUMMARY_MESSAGE_LENGTH = 420;
const MAX_SUMMARY_TRANSCRIPT_CHARACTERS = 5200;

const MAX_MESSAGES_FOR_REPLIES = 16;
const MAX_REPLY_MESSAGE_LENGTH = 320;
const MAX_REPLY_TRANSCRIPT_CHARACTERS = 3600;
const MAX_SUGGESTION_LENGTH = 120;

let generationQueue: Promise<unknown> = Promise.resolve();

/**
 * The shared Llama context should run only one generation request at a time.
 * This prevents summary and reply generation from executing simultaneously.
 */
async function runGenerationTask<T>(task: () => Promise<T>): Promise<T> {
  const nextTask = generationQueue.then(task, task);

  generationQueue = nextTask.then(
    () => undefined,
    () => undefined,
  );

  return nextTask;
}

function normalizeBody(body: string, maxLength: number): string {
  return body.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

/**
 * A human sender cannot be identified through senderType because both
 * participants are stored as "user". Use Clerk user IDs instead.
 */
function getSpeakerLabel(
  message: Message,
  currentClerkUserId: string | null | undefined,
  otherSpeakerName: string,
): string {
  if (message.senderClerkUserId && currentClerkUserId) {
    return message.senderClerkUserId === currentClerkUserId
      ? 'Me'
      : otherSpeakerName;
  }

  if (message.senderType === 'assistant') {
    return 'Assistant';
  }

  /*
   * Old/local messages without senderClerkUserId cannot be identified safely.
   * Never label them as "Me" automatically.
   */
  return 'Unknown sender';
}

function buildTranscript(
  messages: Message[],
  currentClerkUserId: string | null | undefined,
  otherSpeakerName: string,
  maxMessages: number,
  maxMessageLength: number,
  maxTranscriptCharacters: number,
): string {
  const recentMessages = messages
    .slice(-maxMessages)
    .filter((message) => message.body.trim().length > 0);

  const selectedLines: string[] = [];
  let characterCount = 0;

  /*
   * Walk backwards to retain the newest messages if the context limit is
   * reached, then unshift them to preserve chronological order.
   */
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];

    const speaker = getSpeakerLabel(
      message,
      currentClerkUserId,
      otherSpeakerName,
    );

    const body = normalizeBody(message.body, maxMessageLength);
    const line = `${speaker}: ${body}`;

    if (
      characterCount + line.length > maxTranscriptCharacters &&
      selectedLines.length > 0
    ) {
      break;
    }

    selectedLines.unshift(line);
    characterCount += line.length;
  }

  return selectedLines.join('\n');
}

function createSummaryTranscript(
  title: string,
  messages: Message[],
  currentClerkUserId: string | null | undefined,
): string {
  return buildTranscript(
    messages,
    currentClerkUserId,
    title,
    MAX_MESSAGES_FOR_SUMMARY,
    MAX_SUMMARY_MESSAGE_LENGTH,
    MAX_SUMMARY_TRANSCRIPT_CHARACTERS,
  );
}

function createReplyTranscript(
  title: string,
  messages: Message[],
  currentClerkUserId: string | null | undefined,
): string {
  return buildTranscript(
    messages,
    currentClerkUserId,
    title,
    MAX_MESSAGES_FOR_REPLIES,
    MAX_REPLY_MESSAGE_LENGTH,
    MAX_REPLY_TRANSCRIPT_CHARACTERS,
  );
}

function parseReplySuggestions(rawText: string): string[] {
  const cleanedLines = rawText
    .replace(/\r/g, '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*[-*•]\s*/, '')
        .replace(/^\s*\d+[.)]\s*/, '')
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .filter((line) => !/^suggested replies?:?$/i.test(line))
    .filter((line) => !/^repl(y|ies):?$/i.test(line))
    .map((line) => line.slice(0, MAX_SUGGESTION_LENGTH));

  const uniqueLines = Array.from(new Set(cleanedLines));

  if (uniqueLines.length >= 3) {
    return uniqueLines.slice(0, 3);
  }

  /*
   * Small models sometimes return numbered responses on a single line.
   * Try another split before accepting fewer suggestions.
   */
  const inlineNumberedReplies = rawText
    .split(/(?=\s*\d+[.)]\s+)/)
    .map((line) =>
      line
        .replace(/^\s*\d+[.)]\s*/, '')
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .map((line) => line.slice(0, MAX_SUGGESTION_LENGTH));

  return Array.from(new Set([...uniqueLines, ...inlineNumberedReplies])).slice(
    0,
    3,
  );
}

export async function summarizeRecentMessages(
  title: string,
  messages: Message[],
  currentClerkUserId: string | null | undefined,
): Promise<string> {
  const transcript = createSummaryTranscript(
    title,
    messages,
    currentClerkUserId,
  );

  if (!transcript) {
    return `There are no messages in this chat with ${title} to summarize yet.`;
  }

  if (__DEV__) {
    console.log(
      'Summary sender debug:',
      messages.slice(-MAX_MESSAGES_FOR_SUMMARY).map((message) => ({
        body: message.body,
        senderType: message.senderType,
        senderClerkUserId: message.senderClerkUserId,
        currentClerkUserId,
        label: getSpeakerLabel(message, currentClerkUserId, title),
      })),
    );

    console.log('Transcript sent to local Llama summary:\n', transcript);
  }

  const context = await getLocalLlamaContext();

  const result = await runGenerationTask(() =>
    context.completion({
      messages: [
        {
          role: 'system',
          content: [
            'You summarize private chat conversations.',
            'Use only facts explicitly written in the provided chat.',
            'Never guess missing information.',
            'Never add dates, plans, decisions, feelings, or actions unless directly stated.',
            'If something is unclear, omit it.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `Summarize the recent chat with ${title}.`,
            '',
            'Return exactly this format:',
            'TOPIC: one short sentence',
            'KEY FACTS:',
            '- fact explicitly stated in the chat',
            '- fact explicitly stated in the chat',
            'NEXT ACTION: one explicitly stated pending action, or "None stated"',
            '',
            'Important rules:',
            '- Do not invent facts.',
            '- Do not interpret emotions or intentions.',
            '- Do not mention information outside the chat.',
            '- Use at most 3 key facts.',
            '',
            '<CHAT>',
            transcript,
            '</CHAT>',
          ].join('\n'),
        },
      ],
      n_predict: 160,
      temperature: 0.1,
      top_k: 20,
      top_p: 0.9,
      stop: STOP_WORDS,
    }),
  );

  const summary = result.text.trim();

  if (!summary) {
    throw new Error('The local model returned an empty summary.');
  }

  return summary;
}

export async function suggestRepliesForRecentMessages(
  title: string,
  messages: Message[],
  currentClerkUserId: string | null | undefined,
): Promise<ReplySuggestionResult> {
  const transcript = createReplyTranscript(title, messages, currentClerkUserId);

  if (!transcript) {
    return {
      suggestions: [
        'Hey, how are you?',
        'What are you up to today?',
        'Can we talk for a minute?',
      ],
    };
  }

  if (__DEV__) {
    console.log('Transcript sent to local Llama replies:\n', transcript);
  }

  const context = await getLocalLlamaContext();

  const result = await runGenerationTask(() =>
    context.completion({
      messages: [
        {
          role: 'system',
          content: [
            'You write short text-message replies for the user.',
            'Use only the supplied chat context.',
            'Write natural replies the user could send next.',
            'Do not invent facts, promises, dates, names, or actions.',
            'Do not explain your answer.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            'Generate exactly 3 possible replies that I can send next.',
            '',
            'Rules:',
            '- Each reply must be one short sentence.',
            '- Each reply must be under 16 words.',
            '- Make the three options meaningfully different.',
            '- Do not use numbering.',
            '- Do not use bullet symbols.',
            '- Put one reply on each line.',
            '- Do not include quotation marks.',
            '',
            '<CHAT>',
            transcript,
            '</CHAT>',
          ].join('\n'),
        },
      ],
      n_predict: 100,
      temperature: 0.3,
      top_k: 30,
      top_p: 0.9,
      stop: STOP_WORDS,
    }),
  );

  const suggestions = parseReplySuggestions(result.text);

  if (suggestions.length === 0) {
    throw new Error('The local model did not return usable reply suggestions.');
  }

  return {
    suggestions,
  };
}
