import type { Message } from '../types/message';

type ReplySuggestionResult = {
  suggestions: string[];
};

function getRecentMessages(messages: Message[], limit = 30) {
  return messages.slice(-limit);
}

function getLatestMeaningfulMessage(messages: Message[]) {
  const recentMessages = [...getRecentMessages(messages)].reverse();

  return recentMessages.find((message) => message.body.trim().length > 0) ?? null;
}

function getLatestReceivedMessage(messages: Message[]) {
  const recentMessages = [...getRecentMessages(messages)].reverse();

  return (
    recentMessages.find((message) => message.senderType !== 'user' && message.body.trim().length > 0) ??
    getLatestMeaningfulMessage(messages)
  );
}

/**
 * Produces a small mock summary from recent chat history for Day 1 AI UI work.
 * This is intentionally local-only and will later be replaced by the backend.
 */
export async function summarizeRecentMessages(
  title: string,
  messages: Message[],
): Promise<string> {
  const recentMessages = getRecentMessages(messages);
  const latestMessage = getLatestMeaningfulMessage(recentMessages);
  const participantTurns = recentMessages.length;

  await new Promise((resolve) => setTimeout(resolve, 450));

  if (participantTurns === 0) {
    return `This chat with ${title} has no messages yet. Once the conversation starts, AI summary will highlight the main topic and any pending follow-up.`;
  }

  const summaryLead =
    participantTurns <= 4
      ? `This conversation with ${title} is a short exchange with ${participantTurns} recent messages.`
      : `This conversation with ${title} includes ${participantTurns} recent messages and appears to be an active discussion.`;

  const latestPoint = latestMessage
    ? `The latest point is: "${latestMessage.body.trim()}".`
    : 'There is no clear latest point yet.';

  return `${summaryLead} ${latestPoint} The current Day 1 AI summary is using recent local messages only, so it focuses on the latest context and possible follow-up.`;
}

/**
 * Produces mock reply suggestions from recent chat history for Day 1 AI UI work.
 * Suggestions stay short and editable so the user remains in control.
 */
export async function suggestRepliesForRecentMessages(
  messages: Message[],
): Promise<ReplySuggestionResult> {
  const latestReceived = getLatestReceivedMessage(messages);
  const latestText = latestReceived?.body.trim().toLowerCase() ?? '';

  await new Promise((resolve) => setTimeout(resolve, 450));

  if (!latestText) {
    return {
      suggestions: [
        'Sure, I can take a look.',
        'Sounds good to me.',
        'Can you share a bit more detail?',
      ],
    };
  }

  if (latestText.includes('deploy') || latestText.includes('release')) {
    return {
      suggestions: [
        'Sure, I will check the deployment and update you shortly.',
        'I am on it. Let me verify the latest release state first.',
        'Can you point me to the failing environment or error?',
      ],
    };
  }

  if (latestText.includes('meeting') || latestText.includes('summary')) {
    return {
      suggestions: [
        'Yes, I can summarize the main takeaways.',
        'I will put together a short update in a minute.',
        'Do you want the summary focused on action items or decisions?',
      ],
    };
  }

  if (latestText.includes('wrong') || latestText.includes('issue') || latestText.includes('error')) {
    return {
      suggestions: [
        'Okay, I will investigate and get back to you.',
        'Thanks, I am checking the issue now.',
        'Can you share one example so I can trace it quickly?',
      ],
    };
  }

  return {
    suggestions: [
      'Sure, I will check and let you know.',
      'Okay, that works for me.',
      'Can you explain this a bit more?',
    ],
  };
}
