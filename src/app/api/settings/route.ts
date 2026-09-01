import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { users, documents } from '../../../../drizzle/schema';

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    const db = getDb();

    const [user] = await db.select().from(users).where(eq(users.id, userId));

    if (!user) {
      return NextResponse.json({
        name: null,
        preferredLanguage: 'en',
        knownAllergies: [],
        knownConditions: [],
      });
    }

    return NextResponse.json({
      name: user.name,
      preferredLanguage: user.preferredLanguage ?? 'en',
      knownAllergies: user.knownAllergies ?? [],
      knownConditions: user.knownConditions ?? [],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load settings';
    const status = (error as any).statusCode ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const db = getDb();
    const body = await request.json();

    const { preferredLanguage, knownAllergies, knownConditions } = body;

    // Upsert user record
    const [existing] = await db.select().from(users).where(eq(users.id, userId));

    if (existing) {
      await db.update(users)
        .set({
          ...(preferredLanguage !== undefined && { preferredLanguage }),
          ...(knownAllergies !== undefined && { knownAllergies }),
          ...(knownConditions !== undefined && { knownConditions }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } else {
      await db.insert(users).values({
        id: userId,
        email: '',
        preferredLanguage: preferredLanguage ?? 'en',
        knownAllergies: knownAllergies ?? [],
        knownConditions: knownConditions ?? [],
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save settings';
    const status = (error as any).statusCode ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE() {
  try {
    const userId = await getCurrentUserId();
    const db = getDb();

    // Delete all user data (documents cascade to chunks, medications, etc.)
    await db.delete(documents).where(eq(documents.userId, userId));
    await db.delete(users).where(eq(users.id, userId));

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete data';
    const status = (error as any).statusCode ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}
