export function getErrorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors
      .map((entry) => getErrorMessage(entry))
      .filter(Boolean)
      .join('; ');
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function throwIfFailures(
  failures: unknown[],
  fallbackMessage: string,
): void {
  if (failures.length === 0) {
    return;
  }

  const errors = failures.map((failure) =>
    failure instanceof Error ? failure : new Error(String(failure)),
  );

  throw new AggregateError(errors, fallbackMessage);
}
