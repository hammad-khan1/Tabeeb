import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { users } from '../../drizzle/schema';
import { toLocale, type Locale, type PreferredLanguage } from './i18n';

/**
 * Reads the signed-in user's interface language for server components.
 *
 * Deliberately tolerant: this runs in the root layout, which also wraps the sign-in
 * pages and renders before the user row necessarily exists. Any failure — no session,
 * no row, database unreachable — falls back to English rather than failing the render,
 * because a wrong language is recoverable and a blank page is not.
 */
export async function getPreferredLocale(): Promise<Locale> {
  try {
    const { userId } = await auth();
    if (!userId) return 'en';

    const [row] = await getDb()
      .select({ preferredLanguage: users.preferredLanguage })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return toLocale(row?.preferredLanguage as PreferredLanguage | null | undefined);
  } catch {
    return 'en';
  }
}
