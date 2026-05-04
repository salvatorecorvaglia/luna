export class TimeoutError extends Error {
  constructor(
    public op: string,
    public timeoutMs: number,
  ) {
    super(`${op} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/** Race a promise against a timer. Rejects with TimeoutError if the timer wins. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, op: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(op, timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
