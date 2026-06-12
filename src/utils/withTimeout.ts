/**
 * Race a promise against a timeout. Resolves to `null` if the timeout
 * fires before the promise settles.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  promise.catch(() => {});
  return Promise.race([
    promise,
    new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
