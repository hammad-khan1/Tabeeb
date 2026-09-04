import { NextRequest, NextResponse } from 'next/server';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { chatHistorySchema, parseSearchParams } from '@/lib/validation';
import { chatMessages } from '../../../../../drizzle/schema';

export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { conversationId, limit } = parseSearchParams(
      chatHistorySchema,
      request.nextUrl.searchParams
    );

    if (conversationId) {
      const rows = await getDb()
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.conversationId, conversationId),
            eq(chatMessages.userId, userId)
          )
        )
        .orderBy(chatMessages.createdAt);

      return NextResponse.json(rows);
    }

    const conversations = await getDb()
      .select({
        conversationId: chatMessages.conversationId,
        lastMessageAt: sql<string>`MAX(${chatMessages.createdAt})`,
        messageCount: sql<number>`count(*)::int`,
        title: sql<string>`MIN(CASE WHEN ${chatMessages.role} = 'user' THEN LEFT(${chatMessages.content}, 80) END)`,
      })
      .from(chatMessages)
      .where(eq(chatMessages.userId, userId))
      .groupBy(chatMessages.conversationId)
      .orderBy(desc(sql`MAX(${chatMessages.createdAt})`))
      .limit(limit);

    return NextResponse.json(conversations);
  } catch (error) {
    return errorResponse('GET /api/chat/history', error, 'Failed to fetch history');
  }
}
