import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ensureUser ran a SELECT on every authenticated request to answer a question whose
 * answer never changes once it is yes, so every API call in the app carried a
 * database round-trip that did nothing.
 */

let selectCalls = 0;
let insertCalls = 0;
let existingRows: Array<{ id: string }> = [];

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_1' }),
  currentUser: async () => ({
    emailAddresses: [{ emailAddress: 'p@example.com' }],
    firstName: 'Ali',
    lastName: null,
  }),
}));

vi.mock('./db', () => ({
  getDb: () => ({
    select: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'where']) chain[m] = () => chain;
      chain.limit = () => {
        selectCalls += 1;
        return Promise.resolve(existingRows);
      };
      return chain;
    },
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => {
          insertCalls += 1;
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

const { ensureUser, resetProvisionedUsers, forgetProvisionedUser } = await import('./auth');

beforeEach(() => {
  selectCalls = 0;
  insertCalls = 0;
  existingRows = [{ id: 'user_1' }];
  resetProvisionedUsers();
});

describe('ensureUser', () => {
  it('checks the database the first time it sees a user', async () => {
    await ensureUser('user_1');
    expect(selectCalls).toBe(1);
  });

  it('does not check again for a user it has already provisioned', async () => {
    await ensureUser('user_1');
    await ensureUser('user_1');
    await ensureUser('user_1');
    expect(selectCalls).toBe(1);
  });

  it('creates the row when there is none, then stops checking', async () => {
    existingRows = [];
    await ensureUser('user_2');
    expect(insertCalls).toBe(1);

    await ensureUser('user_2');
    expect(selectCalls).toBe(1);
    expect(insertCalls).toBe(1);
  });

  it('checks again after the account is deleted', async () => {
    // Otherwise the cache keeps claiming a row exists and a returning user never
    // gets one re-created.
    await ensureUser('user_1');
    forgetProvisionedUser('user_1');
    await ensureUser('user_1');
    expect(selectCalls).toBe(2);
  });

  it('keeps separate users separate', async () => {
    await ensureUser('user_1');
    await ensureUser('user_3');
    expect(selectCalls).toBe(2);
  });
});
