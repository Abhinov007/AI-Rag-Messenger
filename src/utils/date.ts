/**
 * Date helpers used by chat UI surfaces.
 */

/**
 * Formats a SQLite timestamp for the chat-list last-message time.
 *
 * Today: `3:45 PM`
 * Yesterday: `Yesterday`
 * Older messages: `May 13`
 */
export function formatLastMessageTime(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  const date = parseSqliteDate(value);

  if (!date) {
    return '';
  }

  const now = new Date();

  if (isSameDay(date, now)) {
    return date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(date, yesterday)) {
    return 'Yesterday';
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Formats a message timestamp for display inside chat bubbles.
 */
export function formatMessageTime(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  const date = parseSqliteDate(value);

  if (!date) {
    return '';
  }

  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseSqliteDate(value: string) {
  const date = new Date(value.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
