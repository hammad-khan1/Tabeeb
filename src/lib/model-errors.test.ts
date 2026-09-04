import { describe, it, expect, vi } from 'vitest';
import { classifyModelFailure, withModelRetry } from './model-errors';

/**
 * The message in these tests is the real one Groq returned when a document failed to
 * process, which the app reported to the patient as "re-upload a clearer scan".
 */
const GROQ_DAILY_LIMIT = {
  status: 429,
  message:
    'Rate limit reached for model `qwen/qwen3.8-27b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 194898, Requested 6004. Please try again in 6m29.664s. Need more tokens? Upgrade to Dev Tier today.',
};

describe('classifyModelFailure', () => {
  it('recognises a daily quota error and does not blame the scan', () => {
    const f = classifyModelFailure(GROQ_DAILY_LIMIT);

    expect(f.kind).toBe('rate_limit');
    expect(f.userMessage).toMatch(/daily limit/i);
    // The old message sent the patient to re-photograph a perfectly good document.
    expect(f.userMessage).not.toMatch(/clearer scan/i);
  });

  it('parses the wait out of the message body', () => {
    // "6m29.664s" -> 390 seconds
    expect(classifyModelFailure(GROQ_DAILY_LIMIT).retryAfterSeconds).toBe(390);
  });

  it('reads a Retry-After header when present', () => {
    const f = classifyModelFailure({
      status: 429,
      message: 'Rate limit reached',
      headers: new Headers({ 'retry-after': '30' }),
    });
    expect(f.retryAfterSeconds).toBe(30);
  });

  it('distinguishes a per-minute limit from the daily one', () => {
    const perMinute = classifyModelFailure({
      status: 429,
      message: 'Rate limit reached on tokens per minute (TPM). Please try again in 12.5s.',
    });
    expect(perMinute.kind).toBe('rate_limit');
    expect(perMinute.userMessage).toMatch(/busy right now/i);
    expect(perMinute.userMessage).not.toMatch(/daily/i);
  });

  it('treats a server error as transient', () => {
    const f = classifyModelFailure({ status: 503, message: 'Service Unavailable' });
    expect(f.kind).toBe('transient');
    expect(f.userMessage).toMatch(/nothing is wrong with your file/i);
  });

  it('treats a network failure as transient', () => {
    expect(classifyModelFailure(new Error('fetch failed')).kind).toBe('transient');
    expect(classifyModelFailure({ code: 'ETIMEDOUT', message: 'timeout' }).kind).toBe('transient');
  });

  it('treats a genuine processing error as permanent', () => {
    const f = classifyModelFailure(new Error('Unsupported file type: application/zip'));
    expect(f.kind).toBe('permanent');
    expect(f.userMessage).toMatch(/clearer scan/i);
  });

  it('treats a 400 as permanent, not worth retrying', () => {
    expect(classifyModelFailure({ status: 400, message: 'Invalid request' }).kind).toBe('permanent');
  });
});

describe('withModelRetry', () => {
  it('returns the result when the call succeeds', async () => {
    expect(await withModelRetry(async () => 'ok')).toBe('ok');
  });

  it('retries a short transient failure and then succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const promise = withModelRetry(async () => {
      calls += 1;
      if (calls < 2) throw { status: 503, message: 'Service Unavailable' };
      return 'recovered';
    });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('recovered');
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it('does not retry a permanent failure', async () => {
    let calls = 0;
    await expect(
      withModelRetry(async () => {
        calls += 1;
        throw new Error('Unsupported file type');
      })
    ).rejects.toThrow(/Unsupported/);
    expect(calls).toBe(1);
  });

  it('does not sleep through a long quota wait', async () => {
    // A six-minute wait must surface to the caller so the document gets an accurate
    // status, rather than holding the request open.
    let calls = 0;
    const started = Date.now();
    await expect(
      withModelRetry(async () => {
        calls += 1;
        throw GROQ_DAILY_LIMIT;
      })
    ).rejects.toMatchObject({ status: 429 });

    expect(calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
