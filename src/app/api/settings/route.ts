import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId, forgetProvisionedUser } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-error';
import { getStorage } from '@/lib/storage';
import { parseJsonBody, settingsSchema, deleteAccountSchema } from '@/lib/validation';
import { users } from '../../../../drizzle/schema';

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);

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
    consume('settings', userId);
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

export async function DELETE(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('deleteAccount', userId);
    // Irreversible, so the intent is required explicitly rather than inferred from
    // the caller having reached this endpoint.
    await parseJsonBody(deleteAccountSchema, request);

    // Files first: deleting the user cascades the document rows away, and without
    // their storagePath the files on disk become unreachable orphans. This is what
    // made "delete all my data" leave every uploaded scan behind.
    await getStorage().deleteAll(userId);

    // Cascades to documents, chunks, medications, diagnoses, labs, allergies,
    // imaging findings, chat messages, insights, interaction checks and share links.
    await getDb().delete(users).where(eq(users.id, userId));

    // The provisioning cache still says this id has a row. Without clearing it, a user
    // who deletes their account and signs in again would never get one re-created.
    forgetProvisionedUser(userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse('DELETE /api/settings', error, 'Failed to delete data');
  }
}
