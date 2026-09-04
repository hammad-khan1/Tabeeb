import { describe, it, expect } from 'vitest';
import {
  validateUploadFile,
  parseSearchParams,
  parseOrThrow,
  searchSchema,
  listDocumentsSchema,
  settingsSchema,
  createShareSchema,
  chatSchema,
} from './validation';
import { MAX_FILE_SIZE } from './constants';
import { ApiError } from './api-error';

function file(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function params(query: Record<string, string>): URLSearchParams {
  return new URLSearchParams(query);
}

describe('validateUploadFile', () => {
  it('accepts a supported type within the size limit', () => {
    expect(() => validateUploadFile(file('r.pdf', 'application/pdf', 1024))).not.toThrow();
  });

  it('accepts HEIC, the iPhone camera default', () => {
    // Previously blocked by the uploader even though the extractor handled it.
    expect(() => validateUploadFile(file('p.heic', 'image/heic', 1024))).not.toThrow();
  });

  it('rejects a file over the size limit', () => {
    // Enforced only in the browser before, so a direct POST bypassed it entirely.
    expect(() => validateUploadFile(file('big.pdf', 'application/pdf', MAX_FILE_SIZE + 1)))
      .toThrow(/too large/i);
  });

  it('rejects an unsupported type', () => {
    expect(() => validateUploadFile(file('x.exe', 'application/x-msdownload', 10)))
      .toThrow(/not supported/i);
  });

  it('rejects an empty file', () => {
    expect(() => validateUploadFile(file('e.pdf', 'application/pdf', 0))).toThrow(/empty/i);
  });

  it('rejects a file with no discernible type', () => {
    expect(() => validateUploadFile(file('mystery', '', 10))).toThrow(/could not be determined/i);
  });

  it('ignores charset parameters on the MIME type', () => {
    expect(() => validateUploadFile(file('n.txt', 'text/plain; charset=utf-8', 10))).not.toThrow();
  });
});

describe('searchSchema', () => {
  it('rejects a non-numeric limit instead of silently returning nothing', () => {
    // `parseInt('abc')` produced NaN and `slice(0, NaN)` returned [], so search
    // appeared to work and quietly found nothing.
    expect(() => parseSearchParams(searchSchema, params({ q: 'metformin', limit: 'abc' })))
      .toThrow(ApiError);
  });

  it('rejects a limit above the cap', () => {
    expect(() => parseSearchParams(searchSchema, params({ q: 'x', limit: '100000' })))
      .toThrow(ApiError);
  });

  it('defaults the limit when absent', () => {
    expect(parseSearchParams(searchSchema, params({ q: 'x' })).limit).toBe(6);
  });

  it('requires a non-empty query', () => {
    expect(() => parseSearchParams(searchSchema, params({ q: '   ' }))).toThrow(ApiError);
  });
});

describe('listDocumentsSchema', () => {
  it('rejects an invalid document type rather than passing it to the enum column', () => {
    expect(() => parseSearchParams(listDocumentsSchema, params({ type: 'not_a_type' })))
      .toThrow(ApiError);
  });

  it('rejects an unparseable date', () => {
    expect(() => parseSearchParams(listDocumentsSchema, params({ from: 'yesterday' })))
      .toThrow(ApiError);
  });

  it('parses a valid date into a Date', () => {
    const parsed = parseSearchParams(listDocumentsSchema, params({ from: '2024-03-01' }));
    expect(parsed.from).toBeInstanceOf(Date);
  });

  it('applies pagination defaults', () => {
    const parsed = parseSearchParams(listDocumentsSchema, params({}));
    expect(parsed).toMatchObject({ limit: 50, offset: 0 });
  });
});

describe('settingsSchema', () => {
  it('rejects an invalid language rather than erroring in Postgres', () => {
    expect(() => parseOrThrow(settingsSchema, { preferredLanguage: 'klingon' })).toThrow(ApiError);
  });

  it('rejects a non-array allergy list', () => {
    // These land in jsonb and in the chat system prompt, so shape matters.
    expect(() => parseOrThrow(settingsSchema, { knownAllergies: { a: 1 } })).toThrow(ApiError);
  });

  it('rejects an oversized list', () => {
    const huge = Array.from({ length: 200 }, (_, i) => `item ${i}`);
    expect(() => parseOrThrow(settingsSchema, { knownConditions: huge })).toThrow(ApiError);
  });

  it('accepts a valid update', () => {
    expect(
      parseOrThrow(settingsSchema, { preferredLanguage: 'ur', knownAllergies: ['penicillin'] })
    ).toEqual({ preferredLanguage: 'ur', knownAllergies: ['penicillin'] });
  });

  it('rejects an empty update', () => {
    expect(() => parseOrThrow(settingsSchema, {})).toThrow(ApiError);
  });
});

describe('createShareSchema', () => {
  it('caps the expiry so a record link cannot live indefinitely', () => {
    expect(() => parseOrThrow(createShareSchema, { expiresInHours: 24 * 365 })).toThrow(ApiError);
  });

  it('defaults to a week', () => {
    expect(parseOrThrow(createShareSchema, {}).expiresInHours).toBe(168);
  });

  it('rejects a non-uuid document id', () => {
    expect(() => parseOrThrow(createShareSchema, { documentIds: ['../etc/passwd'] }))
      .toThrow(ApiError);
  });

  it('accepts a null title from an unfilled form field', () => {
    expect(parseOrThrow(createShareSchema, { title: null }).title).toBeUndefined();
  });
});

describe('chatSchema', () => {
  it('accepts the null conversationId the client sends on a new chat', () => {
    // The client keeps conversationId in state that starts as null, so every first
    // message posts an explicit null. `.optional()` accepts undefined but rejects
    // null, which 400'd every new conversation — the chat was entirely broken.
    const parsed = parseOrThrow(chatSchema, { message: 'hello', conversationId: null });
    expect(parsed.conversationId).toBeUndefined();
    expect(parsed.message).toBe('hello');
  });

  it('accepts an omitted conversationId', () => {
    expect(parseOrThrow(chatSchema, { message: 'hello' }).conversationId).toBeUndefined();
  });

  it('accepts a real conversationId on a follow-up', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(parseOrThrow(chatSchema, { message: 'and the dose?', conversationId: id }).conversationId).toBe(id);
  });

  it('requires a message', () => {
    expect(() => parseOrThrow(chatSchema, { message: '  ' })).toThrow(ApiError);
  });

  it('rejects a conversationId that is not a uuid', () => {
    expect(() => parseOrThrow(chatSchema, { message: 'hi', conversationId: 'nope' }))
      .toThrow(ApiError);
  });

  it('caps message length', () => {
    expect(() => parseOrThrow(chatSchema, { message: 'x'.repeat(5000) })).toThrow(ApiError);
  });
});
