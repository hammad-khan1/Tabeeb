import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { localStorage } from '@/lib/storage';
import { parseJsonBody, settingsSchema } from '@/lib/validation';
import { users } from '../../../../drizzle/schema';

export async function GET() {
  try {
    const userId = await getCurrentUserId();

    const [user] = await getDb()
      .select({
        name: users.name,
        preferredLanguage: users.preferredLanguage,
        knownAllergies: users.knownAllergies,
        knownConditions: users.knownConditions,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return NextResponse.json({
      name: user?.name ?? null,
      preferredLanguage: user?.preferredLanguage ?? 'en',
      knownAllergies: user?.knownAllergies ?? [],
      knownConditions: user?.knownConditions ?? [],
    });
  } catch (error) {
    return errorResponse('GET /api/settings', error, 'Failed to load settings');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    // These land in jsonb and, for conditions, in the chat system prompt, so both
    // shape and size are validated rather than taken as given.
    const updates = await parseJsonBody(settingsSchema, request);

    // getCurrentUserId has already ensured the row exists, so this is a plain update
    // rather than the previous select-then-insert, whose insert branch wrote
    // `email: ''` into a unique column and failed for the second user to reach it.
    await getDb()
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse('PATCH /api/settings', error, 'Failed to save settings');
  }
}

export async function DELETE() {
  try {
    const userId = await getCurrentUserId();

    // Files first: deleting the user cascades the document rows away, and without
    // their storagePath the files on disk become unreachable orphans. This is what
    // made "delete all my data" leave every uploaded scan behind.
    await localStorage.deleteAll(userId);

    // Cascades to documents, chunks, medications, diagnoses, labs, allergies,
    // imaging findings, chat messages, insights, interaction checks and share links.
    await getDb().delete(users).where(eq(users.id, userId));

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse('DELETE /api/settings', error, 'Failed to delete data');
  }
}
