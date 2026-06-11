/**
 * Extracts an error message from an error object or unknown value.
 * Handles AggregateError, Error, and other types by converting them to strings.
 * @param error - The error object or value to extract message from
 * @returns A string representation of the error
 */
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

/**
 * Throws an AggregateError if there are any failures, otherwise returns silently.
 * Converts all failures to Error objects for consistent error handling.
 * @param failures - Array of error objects or values
 * @param fallbackMessage - Message to use for the AggregateError
 * @throws AggregateError if failures array is not empty
 */
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
