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

export async function getCurrentUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new AuthError();
  await ensureUser(userId);
  return userId;
}

export async function ensureUser(userId: string): Promise<void> {
  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (existing) return;

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
  } catch {}

  await db.insert(users).values({ id: userId, email, name }).onConflictDoNothing();
}
