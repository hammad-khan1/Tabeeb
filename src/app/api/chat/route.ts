import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { retrieveRelevantChunks } from '@/services/rag/retriever';
import { buildQaPrompt } from '@/services/rag/prompt-builder';
import { streamAnswer } from '@/services/rag/answer-streamer';
import { medications, allergies, users, chatMessages, imagingFindings } from '../../../../drizzle/schema';

interface CacheEntry {
  content: string;
  sources: Array<{ documentId: string; documentTitle: string; documentType: string; section?: string; relevanceScore: number }>;
  createdAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 200;
const responseCache = new Map<string, CacheEntry>();

function getCacheKey(userId: string, message: string): string {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(`${userId}:${normalized}`).digest('hex');
}

function getCachedResponse(key: string): CacheEntry | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedResponse(key: string, content: string, sources: CacheEntry['sources']) {
  if (responseCache.size >= MAX_CACHE_SIZE) {
    const oldest = responseCache.keys().next().value;
    if (oldest) responseCache.delete(oldest);
  }
  responseCache.set(key, { content, sources, createdAt: Date.now() });
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const { message, conversationId: inputConversationId } = await request.json();

    if (!message || typeof message !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const conversationId = inputConversationId || crypto.randomUUID();
    const cacheKey = getCacheKey(userId, message);
    const cached = getCachedResponse(cacheKey);

    if (cached) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ conversationId, sources: cached.sources })}\n\n`)
          );

          const words = cached.content.split(' ');
          for (const word of words) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content: word + ' ' })}\n\n`)
            );
            await new Promise((r) => setTimeout(r, 10));
          }

          try {
            await getDb().insert(chatMessages).values([
              { userId, conversationId, role: 'user', content: message },
              { userId, conversationId, role: 'assistant', content: cached.content, sources: cached.sources.length > 0 ? cached.sources : null },
            ]);
          } catch (err) {
            console.error('[Chat] Failed to persist cached response:', err);
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      return new Response(readable, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      });
    }

    const chunks = await retrieveRelevantChunks(userId, message);

    const [meds, allergyRows, [user], imgFindings] = await Promise.all([
      getDb().select().from(medications).where(eq(medications.userId, userId)),
      getDb().select().from(allergies).where(eq(allergies.userId, userId)),
      getDb().select().from(users).where(eq(users.id, userId)).limit(1),
      getDb().select().from(imagingFindings).where(eq(imagingFindings.userId, userId)),
    ]);

    const userProfile = {
      medications: meds.map((m) => ({
        name: m.name,
        genericName: m.genericName ?? undefined,
        dosage: m.dosage ?? undefined,
        frequency: m.frequency ?? undefined,
        route: m.route ?? undefined,
      })),
      allergies: allergyRows.map((a) => ({
        allergen: a.allergen,
        allergyType: a.allergyType ?? undefined,
        severity: a.severity ?? undefined,
        reaction: a.reaction ?? undefined,
      })),
      conditions: (user?.knownConditions as string[]) ?? [],
      imagingFindings: imgFindings.map((f) => ({
        finding: f.finding,
        bodyPart: f.bodyPart,
        severity: f.severity,
        location: f.location,
        urgencyLevel: f.urgencyLevel,
      })),
    };

    const promptMessages = buildQaPrompt(message, chunks, userProfile);
    const stream = await streamAnswer(promptMessages);

    const encoder = new TextEncoder();
    const sourcesSent = { done: false };
    let fullResponse = '';

    const sources = chunks.map((c) => ({
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      documentType: c.documentType,
      section: c.section,
      relevanceScore: c.relevanceScore,
    }));

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices?.[0]?.delta?.content ?? '';
            if (!content) continue;

            fullResponse += content;

            const payload: { content: string; conversationId?: string; sources?: typeof sources } = { content };

            if (!sourcesSent.done) {
              payload.conversationId = conversationId;
              payload.sources = sources;
              sourcesSent.done = true;
            }

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
            );
          }

          setCachedResponse(cacheKey, fullResponse, sources);

          try {
            await getDb().insert(chatMessages).values([
              { userId, conversationId, role: 'user', content: message },
              { userId, conversationId, role: 'assistant', content: fullResponse, sources: sources.length > 0 ? sources : null },
            ]);
          } catch (err) {
            console.error('[Chat] Failed to persist messages:', err);
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err) {
          console.error('[Chat Stream] Error during streaming:', err);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (error) {
    return errorResponse('POST /api/chat', error, 'Chat failed');
  }
}
