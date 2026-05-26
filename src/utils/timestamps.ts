function normalizeSqliteTimestampShape(value: string) {
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed.replace(' ', 'T')}Z`;
  }

  return trimmed;
}

export function getUtcNowIsoTimestamp() {
  return new Date().toISOString();
}

export function normalizeUtcTimestamp(value?: string | null) {
  if (!value?.trim()) {
    return null;
  }

  const normalizedShape = normalizeSqliteTimestampShape(value);
  const parsed = new Date(normalizedShape);

  if (Number.isNaN(parsed.getTime())) {
    return normalizedShape;
  }

  return parsed.toISOString();
}
