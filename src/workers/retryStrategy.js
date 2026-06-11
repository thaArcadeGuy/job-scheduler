const BACKOFF_SCHEDULE = [
  { baseMs: 1_000,  jitterMs: 300 },
  { baseMs: 5_000,  jitterMs: 1_000 },
  { baseMs: 25_000, jitterMs: 5_000 },
];

export function getBackoffDelay(retryCount) {
  const idx = Math.min(retryCount, BACKOFF_SCHEDULE.length - 1);
  const { baseMs, jitterMs } = BACKOFF_SCHEDULE[idx];

  const jitter = (Math.random() * 2 - 1) * jitterMs;
 
  return Math.max(0, Math.round(baseMs + jitter));
}

export function getNextRetryAt(retryCount) {
  const delayMs = getBackoffDelay(retryCount);
  return new Date(Date.now() + delayMs);
}