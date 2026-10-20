import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getCurrentUserId: vi.fn(async () => { throw new actual.AuthError(); }) };
});
vi.mock('@/lib/db', () => ({ getDb: () => { throw new Error('Unauthorized requests must not read the database'); } }));
import { GET as list } from './route';
import { GET as detail } from './[id]/route';
import { POST as confirm } from './[id]/confirmation/route';
import { GET as findings } from './findings/route';
import { POST as review } from './findings/[id]/review/route';
import { GET as timeline } from './timeline/route';
import { GET as compare } from './compare/route';

describe('medication authentication boundary without a database', () => {
  it.each([list, detail, confirm, findings, review, timeline, compare])('returns private 401 JSON before parsing or data access', async (handler) => {
    const response = await handler(
      new NextRequest('http://localhost/api/medications'),
      { params: Promise.resolve({ id: 'invalid' }) }
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toContain('private, no-store');
    expect(await response.json()).toEqual({ error: 'Not authenticated' });
  });
});
