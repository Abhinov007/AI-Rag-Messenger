import type {
  AiRequestPayload,
  OllamaGenerateResponse,
  SuggestReplyResponse,
  SummarizeResponse,
} from '../types/ai.js';
import { buildReplyPrompt, buildSummaryPrompt } from './prompts.js';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'llama3.2';

function getOllamaConfig() {
  return {
    baseUrl: process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL,
    model: process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL,
  };
}

export async function checkOllamaHealth() {
  const { baseUrl, model } = getOllamaConfig();
  const response = await fetch(`${baseUrl}/api/tags`);

  if (!response.ok) {
    throw new Error(`Ollama health check failed with status ${response.status}`);
  }

  return { model };
}

async function callOllama(prompt: string) {
  const { baseUrl, model } = getOllamaConfig();

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with status ${response.status}`);
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  const text = data.response?.trim();

  if (!text) {
    throw new Error('Ollama returned an empty response.');
  }

  return text;
}

function normalizeSummary(text: string): SummarizeResponse {
  return {
    summary: text.replace(/\s+/g, ' ').trim(),
  };
}

function normalizeSuggestions(text: string): SuggestReplyResponse {
  const suggestions = text
    .split('\n')
    .map((line) => line.replace(/^\s*[\-\d.)]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3);

  if (suggestions.length !== 3) {
    throw new Error('Ollama did not return exactly 3 reply suggestions.');
  }

  return { suggestions };
}

export async function summarizeChat(
  payload: AiRequestPayload,
): Promise<SummarizeResponse> {
  const prompt = buildSummaryPrompt(payload);
  const text = await callOllama(prompt);
  return normalizeSummary(text);
}

export async function suggestReplies(
  payload: AiRequestPayload,
): Promise<SuggestReplyResponse> {
  const prompt = buildReplyPrompt(payload);
  const text = await callOllama(prompt);
  return normalizeSuggestions(text);
}
