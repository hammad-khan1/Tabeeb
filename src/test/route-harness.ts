import { config } from 'dotenv';
import { eq, inArray } from 'drizzle-orm';
import { vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Harness for route-level tests, run against a real database.
 *
 * These deliberately do not mock the database. Every serious defect found in this
 * codebase lived in a route handler and was a missing `WHERE user_id` — the
 * cross-tenant reprocess, the share-scope leak. A mocked database cannot catch that
 * class of bug at all: the mock returns whatever rows it was told to, regardless of
 * the predicate, so a handler that forgets to scope by user passes just as green as
 * one that remembers. Only real SQL can fail that test.
 *
 * Clerk is the one thing that must be faked, since there is no session in a test
 * process. `actAs()` chooses whose requests these are.
 */

config({ path: '.env.local' });

export const HAS_DATABASE = Boolean(process.env.DATABASE_URL);

/** Namespaced so a failed run cannot collide with real data or another run. */
const RUN = `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
export const USER_A = `${RUN}_a`;
export const USER_B = `${RUN}_b`;

let currentUser = USER_A;

/** Whose session subsequent route calls run under. */
export function actAs(userId: string): void {
  currentUser = userId;
}

export function currentUserId(): string {
  return currentUser;
}

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: currentUser }),
  currentUser: async () => ({
    emailAddresses: [{ emailAddress: `${currentUser}@test.local` }],
    firstName: 'Test',
    lastName: null,
  }),
}));

/** Storage is a filesystem side effect; the routes' contract with it is what matters. */
export const storedFiles = new Map<string, Buffer>();

vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    async save(userId: string, fileName: string, data: Buffer) {
      const path = `${userId}/${fileName}`;
      storedFiles.set(path, data);
      return path;
    },
    async read(path: string) {
      const data = storedFiles.get(path);
      if (!data) throw new Error('not found');
      return data;
    },
    async delete(path: string) {
      storedFiles.delete(path);
    },
    async deleteAll(userId: string) {
      for (const key of [...storedFiles.keys()]) {
        if (key.startsWith(`${userId}/`)) storedFiles.delete(key);
      }
    },
  }),
}));

/** Processing calls vision and embedding APIs; the routes only need it to be queued. */
export const enqueued: Array<{ documentId: string; userId: string }> = [];

vi.mock('@/services/processing-queue', () => ({
  enqueueProcessing: (documentId: string, userId: string) => {
    enqueued.push({ documentId, userId });
  },
  // The whole surface, not just the parts a first test happened to reach: a partial
  // mock fails at the call site as an opaque 500 that reads like a handler bug.
  sweepStalledDocuments: async () => 0,
  maybeSweepStalledDocuments: () => {},
  countProcessing: async () => 0,
}));

const { getDb } = await import('@/lib/db');
const schema = await import('../../drizzle/schema');

export const db = getDb();
export const tables = schema;

export async function seedUsers(): Promise<void> {
  await db
    .insert(schema.users)
    .values([
      { id: USER_A, email: `${USER_A}@test.local`, name: 'A' },
      { id: USER_B, email: `${USER_B}@test.local`, name: 'B' },
    ])
    .onConflictDoNothing();
}

export interface SeedDocumentOptions {
  title?: string;
  documentType?: (typeof schema.documents.documentType.enumValues)[number];
  extractionStatus?: (typeof schema.documents.extractionStatus.enumValues)[number];
  rawExtractedText?: string;
}

export async function seedDocument(
  userId: string,
  options: SeedDocumentOptions = {}
): Promise<string> {
  const fileName = `seed_${Math.random().toString(36).slice(2, 8)}.txt`;
  const storagePath = `${userId}/${fileName}`;
  storedFiles.set(storagePath, Buffer.from('seed contents'));

  const [row] = await db
    .insert(schema.documents)
    .values({
      userId,
      title: options.title ?? 'Seed document',
      documentType: options.documentType ?? 'other',
      fileName,
      mimeType: 'text/plain',
      fileSize: 13,
      storagePath,
      extractionStatus: options.extractionStatus ?? 'confirmed',
      rawExtractedText: options.rawExtractedText ?? 'seed contents',
    })
    .returning({ id: schema.documents.id });

  return row.id;
}

/** Removes everything this run created. Cascades handle the derived rows. */
export async function cleanup(): Promise<void> {
  await db.delete(schema.users).where(inArray(schema.users.id, [USER_A, USER_B]));
  storedFiles.clear();
  enqueued.length = 0;
}

export async function documentExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .limit(1);
  return Boolean(row);
}

/**
 * A route handler's params argument. Generic so it satisfies each handler's own
 * param shape rather than widening to Record<string, string>.
 */
export function params<T extends Record<string, string>>(values: T): { params: Promise<T> } {
  return { params: Promise.resolve(values) };
}

/**
 * Route handlers take a NextRequest and several read `nextUrl`, which a plain Request
 * does not have — passing one produces a 500 that looks like a handler bug.
 */
export function nextRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

export function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return nextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
