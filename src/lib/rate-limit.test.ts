import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { consume, resetRateLimits, RateLimitError, LIMITS } from './rate-limit';

beforeEach(() => {
  resetRateLimits();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('consume', () => {
  it('allows requests up to the limit', () => {
    for (let i = 0; i < LIMITS.chat.limit; i += 1) {
      expect(() => consume('chat', 'user_1')).not.toThrow();
    }
  });

  it('rejects the request after the limit', () => {
    for (let i = 0; i < LIMITS.chat.limit; i += 1) consume('chat', 'user_1');
    expect(() => consume('chat', 'user_1')).toThrow(RateLimitError);
  });

  it('reports how long to wait', () => {
    for (let i = 0; i < LIMITS.insights.limit; i += 1) consume('insights', 'user_1');
    try {
      consume('insights', 'user_1');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      const retry = (error as RateLimitError).retryAfterSeconds;
      expect(retry).toBeGreaterThan(0);
      expect(retry).toBeLessThanOrEqual(LIMITS.insights.windowMs / 1000);
    }
  });

  it('counts each user separately', () => {
    for (let i = 0; i < LIMITS.chat.limit; i += 1) consume('chat', 'user_1');
    expect(() => consume('chat', 'user_2')).not.toThrow();
  });

  it('counts each scope separately', () => {
    for (let i = 0; i < LIMITS.insights.limit; i += 1) consume('insights', 'user_1');
    expect(() => consume('chat', 'user_1')).not.toThrow();
  });

  it('resets once the window has passed', () => {
    for (let i = 0; i < LIMITS.chat.limit; i += 1) consume('chat', 'user_1');
    expect(() => consume('chat', 'user_1')).toThrow(RateLimitError);

    vi.advanceTimersByTime(LIMITS.chat.windowMs + 1);

    expect(() => consume('chat', 'user_1')).not.toThrow();
  });

  it('keeps the model-backed routes on tighter limits than search', () => {
    // Insights reads the whole record and generates a long digest; search only
    // embeds a query.
    const rate = (l: { limit: number; windowMs: number }) => l.limit / l.windowMs;
    expect(rate(LIMITS.insights)).toBeLessThan(rate(LIMITS.search));
    expect(rate(LIMITS.upload)).toBeLessThan(rate(LIMITS.search));
  });
});
