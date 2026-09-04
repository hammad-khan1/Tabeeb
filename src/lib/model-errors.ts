/**
 * Classifying model-API failures.
 *
 * A document that failed because the daily token quota ran out is not the same as a
 * document that failed because the scan is unreadable, but both used to end up marked
 * `failed` with the message "try again with a clearer scan" — advice that is actively
 * wrong for a quota error and sends the patient off to re-photograph a perfectly good
 * document.
 */

export type FailureKind = 'rate_limit' | 'transient' | 'permanent';

export interface ClassifiedFailure {
  kind: FailureKind;
  /** Seconds to wait before retrying, when the API told us. */
  retryAfterSeconds: number | null;
  /** Safe to show a patient. */
  userMessage: string;
  /** Full detail for the log. */
  detail: string;
}

interface ErrorLike {
  status?: number;
  message?: string;
  code?: string;
  headers?: Headers | Record<string, string>;
}

function headerValue(error: ErrorLike, name: string): string | null {
  const headers = error.headers;
  if (!headers) return null;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}

/**
 * Groq reports the wait in the message body ("Please try again in 6m29.664s") as well
 * as, sometimes, a Retry-After header. The message is the more reliable of the two for
 * daily-quota errors.
 */
function parseRetryAfter(error: ErrorLike): number | null {
  const header = headerValue(error, 'retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  }

  const message = error.message ?? '';
  const composite = message.match(/try again in\s+(?:(\d+)m)?([\d.]+)s/i);
  if (composite) {
    const minutes = composite[1] ? Number(composite[1]) : 0;
    return Math.ceil(minutes * 60 + Number(composite[2]));
  }

  return null;
}

function describeWait(seconds: number | null): string {
  if (seconds === null) return 'in a few minutes';
  if (seconds < 90) return 'in about a minute';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in about ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
}

export function classifyModelFailure(error: unknown): ClassifiedFailure {
  const err = (error ?? {}) as ErrorLike;
  const detail = err.message ?? String(error);
  const status = typeof err.status === 'number' ? err.status : undefined;
  const retryAfterSeconds = parseRetryAfter(err);

  if (status === 429 || /rate.?limit|quota|too many requests/i.test(detail)) {
    // Distinguish the per-minute ceiling from the daily one: the first clears itself,
    // the second means no more documents today without a plan change.
    const daily = /per day|TPD|RPD|tokens per day/i.test(detail);
    return {
      kind: 'rate_limit',
      retryAfterSeconds,
      userMessage: daily
        ? `The daily limit for the AI service has been reached. This document has not been processed yet — it will work again ${describeWait(retryAfterSeconds)}. Use "Reprocess" then.`
        : `The AI service is busy right now. This document has not been processed yet — try "Reprocess" ${describeWait(retryAfterSeconds)}.`,
      detail,
    };
  }

  if (
    (status !== undefined && status >= 500) ||
    err.code === 'ECONNRESET' ||
    err.code === 'ETIMEDOUT' ||
    /timeout|aborted|fetch failed|network|socket hang up|ECONNREFUSED/i.test(detail)
  ) {
    return {
      kind: 'transient',
      retryAfterSeconds,
      userMessage:
        'The AI service could not be reached while processing this document. Nothing is wrong with your file — use "Reprocess" to try again.',
      detail,
    };
  }

  return {
    kind: 'permanent',
    retryAfterSeconds: null,
    userMessage:
      'This document could not be processed. Use "Reprocess" to try again, or re-upload a clearer scan.',
    detail,
  };
}

/** Beyond this the wait is too long to hold a request open; the caller reports instead. */
const MAX_INLINE_RETRY_WAIT_SECONDS = 45;
const DEFAULT_BACKOFF_MS = [1_000, 4_000, 10_000];

/**
 * Retries a model call through short transient failures. A long wait — the daily quota
 * being the usual one — is not slept through: it is rethrown so the caller can record
 * an accurate status instead of holding a request open for six minutes.
 */
export async function withModelRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; label?: string } = {}
): Promise<T> {
  const attempts = options.attempts ?? 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const classified = classifyModelFailure(error);

      if (classified.kind === 'permanent') throw error;
      if (attempt === attempts - 1) throw error;

      const suggested = classified.retryAfterSeconds;
      if (suggested !== null && suggested > MAX_INLINE_RETRY_WAIT_SECONDS) throw error;

      const waitMs =
        suggested !== null
          ? Math.ceil(suggested * 1000) + 250
          : DEFAULT_BACKOFF_MS[Math.min(attempt, DEFAULT_BACKOFF_MS.length - 1)];

      console.warn(
        `[${options.label ?? 'model'}] ${classified.kind} failure, retrying in ${Math.round(
          waitMs / 1000
        )}s (attempt ${attempt + 1}/${attempts})`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}
