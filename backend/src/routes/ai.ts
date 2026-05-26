import { Router } from 'express';

import { checkOllamaHealth, suggestReplies, summarizeChat } from '../services/ollama.js';
import type { AiRequestPayload } from '../types/ai.js';

const router = Router();

function isValidMessage(message: unknown): message is AiRequestPayload['messages'][number] {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const candidate = message as Record<string, unknown>;

  return (
    typeof candidate.sender === 'string' &&
    typeof candidate.body === 'string' &&
    typeof candidate.createdAt === 'string'
  );
}

function parseAiPayload(body: unknown): AiRequestPayload | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const candidate = body as Record<string, unknown>;

  if (
    typeof candidate.conversationId !== 'number' ||
    typeof candidate.title !== 'string' ||
    !Array.isArray(candidate.messages) ||
    !candidate.messages.every(isValidMessage)
  ) {
    return null;
  }

  return {
    conversationId: candidate.conversationId,
    title: candidate.title.trim(),
    messages: candidate.messages.map((message) => ({
      sender: message.sender,
      body: message.body.trim(),
      createdAt: message.createdAt,
    })),
  };
}

router.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'airagmessenger-backend',
  });
});

router.get('/health/ollama', async (_request, response) => {
  try {
    const info = await checkOllamaHealth();
    response.json({
      ok: true,
      provider: 'ollama',
      model: info.model,
    });
  } catch (error) {
    response.status(503).json({
      detail: error instanceof Error ? error.message : 'Ollama is unavailable.',
    });
  }
});

router.post('/ai/summarize', async (request, response) => {
  const payload = parseAiPayload(request.body);

  if (!payload) {
    response.status(422).json({
      detail: 'Invalid summarize payload.',
    });
    return;
  }

  try {
    const result = await summarizeChat(payload);
    response.json(result);
  } catch (error) {
    response.status(503).json({
      detail: error instanceof Error ? error.message : 'Summarization failed.',
    });
  }
});

router.post('/ai/suggest-reply', async (request, response) => {
  const payload = parseAiPayload(request.body);

  if (!payload) {
    response.status(422).json({
      detail: 'Invalid suggest-reply payload.',
    });
    return;
  }

  try {
    const result = await suggestReplies(payload);
    response.json(result);
  } catch (error) {
    response.status(503).json({
      detail: error instanceof Error ? error.message : 'Reply suggestion failed.',
    });
  }
});

export default router;
