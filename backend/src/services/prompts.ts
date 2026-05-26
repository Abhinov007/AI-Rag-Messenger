import type { AiRequestPayload, ChatMessagePayload } from '../types/ai.js';

const MAX_CONTEXT_MESSAGES = 30;

function formatMessages(messages: ChatMessagePayload[]) {
  return messages
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((message) => {
      const sender = message.sender.toUpperCase();
      return `[${message.createdAt}] ${sender}: ${message.body.trim()}`;
    })
    .join('\n');
}

export function buildSummaryPrompt(payload: AiRequestPayload) {
  const transcript = formatMessages(payload.messages);

  return [
    'You are summarizing a private chat conversation.',
    'Write one short paragraph in plain English.',
    'Include the main topic, key update, and any pending action if present.',
    'Do not invent facts.',
    'Do not use markdown or bullet points.',
    `Conversation title: ${payload.title}`,
    'Recent messages:',
    transcript || 'No recent messages.',
  ].join('\n');
}

export function buildReplyPrompt(payload: AiRequestPayload) {
  const transcript = formatMessages(payload.messages);

  return [
    'You help draft short, natural reply suggestions for a private chat.',
    'Return exactly 3 reply suggestions.',
    'Each reply must be on its own line.',
    'Keep replies brief, natural, and editable.',
    'Match the tone of the conversation.',
    'Do not add numbering, markdown, or commentary.',
    'Do not auto-send or mention auto-send.',
    `Conversation title: ${payload.title}`,
    'Recent messages:',
    transcript || 'No recent messages.',
  ].join('\n');
}
