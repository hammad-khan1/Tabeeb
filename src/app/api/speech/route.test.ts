import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as translatePost } from './translate/route';
import { POST as synthesizePost } from './synthesize/route';

vi.mock('@/lib/auth', () => ({
  getCurrentUserId: vi.fn(async () => 'test_user_id'),
  AuthError: class AuthError extends Error {
    statusCode = 401;
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  consume: vi.fn(),
  RateLimitError: class RateLimitError extends Error {
    retryAfterSeconds = 60;
  },
}));

vi.mock('@/services/speech/translator', () => ({
  translateMedicalTextToUrdu: vi.fn(async (text: string) => {
    return `اردو ترجمہ: ${text}`;
  }),
}));

vi.mock('@/services/speech/tts-provider', () => ({
  synthesizeSpeech: vi.fn(async (_text: string, _lang: string) => ({
    buffer: Buffer.from('mock-audio-data'),
    mimeType: 'audio/mpeg',
  })),
}));

describe('Speech API Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/speech/translate', () => {
    it('rejects invalid JSON body', async () => {
      const req = new NextRequest('http://localhost:3000/api/speech/translate', {
        method: 'POST',
        body: 'invalid-json',
      });
      const res = await translatePost(req);
      expect(res.status).toBe(400);
    });

    it('rejects empty text', async () => {
      const req = new NextRequest('http://localhost:3000/api/speech/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      });
      const res = await translatePost(req);
      expect(res.status).toBe(400);
    });

    it('translates medical text to Urdu', async () => {
      const req = new NextRequest('http://localhost:3000/api/speech/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Take Panadol 500 mg twice daily.' }),
      });
      const res = await translatePost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.language).toBe('ur');
      expect(data.translatedText).toContain('اردو ترجمہ');
    });
  });

  describe('POST /api/speech/synthesize', () => {
    it('rejects invalid language option', async () => {
      const req = new NextRequest('http://localhost:3000/api/speech/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello', lang: 'fr' }),
      });
      const res = await synthesizePost(req);
      expect(res.status).toBe(400);
    });

    it('synthesizes audio stream with audio/mpeg content type', async () => {
      const req = new NextRequest('http://localhost:3000/api/speech/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Take Panadol 500 mg twice daily.',
          lang: 'en',
        }),
      });
      const res = await synthesizePost(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
      const arrayBuf = await res.arrayBuffer();
      expect(Buffer.from(arrayBuf).toString()).toBe('mock-audio-data');
    });
  });
});
