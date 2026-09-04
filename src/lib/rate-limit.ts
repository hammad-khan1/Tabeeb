/**
 * Per-user fixed-window rate limiting.
 *
 * This is an in-process counter, which means it is per-instance: with several server
 * instances each enforces the limit separately, and a cold start resets it. That is a
 * real weakness, but an approximate limit on the model-backed routes is far better
 * than the none that was here before. Moving to Redis is a drop-in replacement of
 * `consume` — the call sites do not change.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Bounds memory when many distinct users hit the process. */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimit {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Tuned to what each route costs: model calls are scarcer than reads. */
export const LIMITS = {
  /** Vision OCR + extraction + embeddings — the most expensive path. */
  upload: { limit: 20, windowMs: 60 * 60 * 1000 },
  /** Re-runs the whole processing pipeline. */
  reprocess: { limit: 10, windowMs: 60 * 60 * 1000 },
  chat: { limit: 30, windowMs: 5 * 60 * 1000 },
  /** Reads the entire record and generates a long digest. */
  insights: { limit: 5, windowMs: 60 * 60 * 1000 },
  interactions: { limit: 20, windowMs: 10 * 60 * 1000 },
  transcribe: { limit: 30, windowMs: 60 * 60 * 1000 },
  /** Embeds the query, so it is not free, but it is cheap. */
  search: { limit: 60, windowMs: 60 * 1000 },
  share: { limit: 20, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimit>;

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export class RateLimitError extends Error {
  readonly statusCode = 429;

  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests. Please wait a moment and try again.');
    this.name = 'RateLimitError';
  }
}

/**
 * Records one request against `scope` for `userId`. Throws RateLimitError when the
 * window is exhausted, which `errorResponse` maps to a 429 with Retry-After.
 */
export function consume(scope: keyof typeof LIMITS, userId: string): void {
  const { limit, windowMs } = LIMITS[scope];
  const now = Date.now();
  const key = `${scope}:${userId}`;

  if (windows.size > MAX_TRACKED_KEYS) sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (existing.count >= limit) {
    throw new RateLimitError(Math.max(1, Math.ceil((existing.resetAt - now) / 1000)));
  }

  existing.count += 1;
}

/** Test seam — call sites never need this. */
export function resetRateLimits(): void {
  windows.clear();
}
