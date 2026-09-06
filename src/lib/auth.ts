import { auth, currentUser } from '@clerk/nextjs/server';
import { getDb } from './db';
import { users } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

export class AuthError extends Error {
  readonly statusCode = 401;

  constructor(message = 'Not authenticated') {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * User ids known to have a row already.
 *
 * `ensureUser` ran a SELECT on every authenticated request to answer a question whose
 * answer never changes once it is yes — so every API call in the app paid for a
 * database round-trip to learn nothing. Provisioning happens once per user; after
 * that this set answers it.
 *
 * Bounded, because a long-running server should not hold every id it has ever seen.
 * An eviction only costs one extra SELECT.
 */
const PROVISIONED_CACHE_LIMIT = 10_000;
const provisioned = new Set<string>();

function remember(userId: string): void {
  if (provisioned.size >= PROVISIONED_CACHE_LIMIT) {
    const oldest = provisioned.values().next().value;
    if (oldest !== undefined) provisioned.delete(oldest);
  }
  provisioned.add(userId);
}

export async function getCurrentUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new AuthError();
  await ensureUser(userId);
  return userId;
}

export async function ensureUser(userId: string): Promise<void> {
  if (provisioned.has(userId)) return;

  const db = getDb();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (existing) {
    remember(userId);
    return;
  }

  let email = `${userId}@placeholder.local`;
  let name: string | null = null;
  try {
    const user = await currentUser();
    if (user) {
      email = user.emailAddresses?.[0]?.emailAddress ?? email;
      name = user.firstName
        ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
        : null;
    }
  } catch (error) {
    // The fallback below is correct, but silence was not: the user ends up with a
    // placeholder email that the settings page then shows them, and nothing said why.
    console.warn(
      `[auth] could not read the Clerk profile for ${userId}; using a placeholder email:`,
      error instanceof Error ? error.message : error
    );
  }

  await db.insert(users).values({ id: userId, email, name }).onConflictDoNothing();
  remember(userId);
}

/**
 * Forgets a provisioned user. Called when an account is deleted, so a subsequent
 * request re-creates the row rather than assuming one that no longer exists.
 */
export function forgetProvisionedUser(userId: string): void {
  provisioned.delete(userId);
}

/** Test seam. */
export function resetProvisionedUsers(): void {
  provisioned.clear();
}
