import { NextRequest } from 'next/server';
import { eq, and, desc, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { chatSchema, parseJsonBody } from '@/lib/validation';
import { retrieveRelevantChunks } from '@/services/rag/retriever';
import { buildQaPrompt } from '@/services/rag/prompt-builder';
import { rewriteForRetrieval, type ConversationTurn } from '@/services/rag/query-rewriter';
import { streamAnswer } from '@/services/rag/answer-streamer';
import {
  medications,
  allergies,
  users,
  chatMessages,
  imagingFindings,
  documents,
} from '../../../../drizzle/schema';

export const maxDuration = 120;

type Source = {
  documentId: string;
  documentTitle: string;
  documentType: string;
  section?: string;
  relevanceScore: number;
};

/** Turns fed back into retrieval and the prompt. */
const HISTORY_TURNS = 8;

/** Caps the per-question profile queries so one huge record cannot blow the prompt. */
const PROFILE_LIMIT = 100;

// ── Response cache ──────────────────────────────────────────────────────────
//
// Still in-process, so it is per-instance and empty after a cold start. What is fixed
// is correctness: the key now includes a fingerprint of the user's corpus, so
// uploading or deleting a document invalidates every cached answer for that user
// instead of serving a pre-upload "I couldn't find that" for the next five minutes.

interface CacheEntry {
  content: string;
  sources: Source[];
  createdAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 200;
const responseCache = new Map<string, CacheEntry>();

async function corpusFingerprint(userId: string): Promise<string> {
  const [row] = await getDb()
    .select({
      count: sql<number>`count(*)::int`,
      latest: sql<string | null>`max(${documents.updatedAt})`,
    })
    .from(documents)
    .where(eq(documents.userId, userId));

  return `${row?.count ?? 0}:${row?.latest ?? 'none'}`;
}

function getCacheKey(userId: string, message: string, fingerprint: string): string {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(`${userId}:${fingerprint}:${normalized}`).digest('hex');
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

function setCachedResponse(key: string, content: string, sources: Source[]): void {
  if (responseCache.size >= MAX_CACHE_SIZE) {
    const oldest = responseCache.keys().next().value;
    if (oldest) responseCache.delete(oldest);
  }
  responseCache.set(key, { content, sources, createdAt: Date.now() });
}

// ── Persistence ─────────────────────────────────────────────────────────────

async function persistTurn(
  userId: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  sources?: Source[]
): Promise<void> {
  try {
    await getDb().insert(chatMessages).values({
      userId,
      conversationId,
      role,
      content,
      sources: sources && sources.length > 0 ? sources : null,
    });
  } catch (error) {
    console.error(`[Chat] failed to persist ${role} message:`, error);
  }
}

async function loadHistory(
  userId: string,
  conversationId: string
): Promise<ConversationTurn[]> {
  const rows = await getDb()
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(
      and(eq(chatMessages.userId, userId), eq(chatMessages.conversationId, conversationId))
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(HISTORY_TURNS);

  return rows
    .reverse()
    .filter((row): row is { role: 'user' | 'assistant'; content: string } =>
      row.role === 'user' || row.role === 'assistant'
    );
}

function sse(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('chat', userId);

    const { message, conversationId: inputConversationId } = await parseJsonBody(
      chatSchema,
      request
    );

    const conversationId = inputConversationId || crypto.randomUUID();
    const isExisting = Boolean(inputConversationId);

    // Recorded immediately. Previously both messages were written only after the
    // stream completed, so an aborted or empty generation discarded the question the
    // patient had already asked.
    await persistTurn(userId, conversationId, 'user', message);

    const history = isExisting ? await loadHistory(userId, conversationId) : [];
    // The just-persisted question would otherwise appear twice.
    const priorTurns = history.filter(
      (turn, index) => !(index === history.length - 1 && turn.role === 'user' && turn.content === message)
    );

    const fingerprint = await corpusFingerprint(userId);
    const cacheKey = getCacheKey(userId, message, fingerprint);

    // Only first turns are cacheable: a follow-up's meaning depends on the thread.
    const cached = priorTurns.length === 0 ? getCachedResponse(cacheKey) : null;

    if (cached) {
      await persistTurn(userId, conversationId, 'assistant', cached.content, cached.sources);

      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(sse({ conversationId, sources: cached.sources }));
          // Sent whole. The previous version replayed it word by word with a 10ms
          // sleep per word — about four seconds of fake typing for text already in
          // memory.
          controller.enqueue(sse({ content: cached.content }));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      return new Response(readable, { headers: SSE_HEADERS });
    }

    // Resolves "what about the second one?" into something retrievable.
    const retrievalQuery = await rewriteForRetrieval(message, priorTurns);
    const chunks = await retrieveRelevantChunks(userId, retrievalQuery);

    const [meds, allergyRows, [user], imgFindings] = await Promise.all([
      getDb()
        .select()
        .from(medications)
        .where(and(eq(medications.userId, userId), eq(medications.isActive, true)))
        .limit(PROFILE_LIMIT),
      getDb().select().from(allergies).where(eq(allergies.userId, userId)).limit(PROFILE_LIMIT),
      getDb().select().from(users).where(eq(users.id, userId)).limit(1),
      getDb()
        .select()
        .from(imagingFindings)
        .where(eq(imagingFindings.userId, userId))
        .orderBy(desc(imagingFindings.createdAt))
        .limit(PROFILE_LIMIT),
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

    const sources: Source[] = chunks.map((c) => ({
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      documentType: c.documentType,
      section: c.section,
      relevanceScore: c.relevanceScore,
    }));

    const promptMessages = buildQaPrompt(message, chunks, userProfile, priorTurns);
    const stream = await streamAnswer(promptMessages);

    let fullResponse = '';

    const readable = new ReadableStream({
      async start(controller) {
        // Metadata goes out before the model produces anything, so the client always
        // learns the conversation id even when the answer is empty. It used to ride
        // on the first non-empty content delta.
        controller.enqueue(sse({ conversationId, sources }));

        try {
          for await (const chunk of stream) {
            const content = chunk.choices?.[0]?.delta?.content ?? '';
            if (!content) continue;
            fullResponse += content;
            controller.enqueue(sse({ content }));
          }

          if (fullResponse) {
            if (priorTurns.length === 0) setCachedResponse(cacheKey, fullResponse, sources);
            await persistTurn(userId, conversationId, 'assistant', fullResponse, sources);
          }

          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        } catch (error) {
          console.error('[Chat] stream error:', error);
          // Keep whatever was generated before the failure rather than losing it.
          if (fullResponse) {
            await persistTurn(userId, conversationId, 'assistant', fullResponse, sources);
          }
          controller.enqueue(sse({ error: 'The answer was interrupted. Please try again.' }));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, { headers: SSE_HEADERS });
  } catch (error) {
    return errorResponse('POST /api/chat', error, 'Chat failed');
  }
}
