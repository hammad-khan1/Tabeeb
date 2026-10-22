import { NextRequest } from 'next/server';
import { eq, and, desc, sql, inArray, or, isNull } from 'drizzle-orm';
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
import { resolveSourceScope } from '@/services/rag/source-scope-resolver';
import { pakistanMedicationCatalogService } from '@/services/medications/pakistan-catalog/catalog-service';
import {
  medications,
  allergies,
  users,
  chatMessages,
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

function getCacheKey(userId: string, message: string, fingerprint: string, scopeKey: string): string {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(`${userId}:${fingerprint}:${scopeKey}:${normalized}`).digest('hex');
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
): Promise<Array<ConversationTurn & { sources?: Source[] }>> {
  const rows = await getDb()
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      sources: chatMessages.sources,
    })
    .from(chatMessages)
    .where(
      and(eq(chatMessages.userId, userId), eq(chatMessages.conversationId, conversationId))
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(HISTORY_TURNS);

  return rows
    .reverse()
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content,
      sources: (row.sources as Source[] | null) ?? undefined,
    }));
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

    const { message, conversationId: inputConversationId, scope: requestedScope } = await parseJsonBody(
      chatSchema,
      request
    );

    const conversationId = inputConversationId || crypto.randomUUID();
    const isExisting = Boolean(inputConversationId);

    // Record user message immediately
    await persistTurn(userId, conversationId, 'user', message);

    const history = isExisting ? await loadHistory(userId, conversationId) : [];
    // The just-persisted question would otherwise appear twice
    const priorTurns = history.filter(
      (turn, index) => !(index === history.length - 1 && turn.role === 'user' && turn.content === message)
    );

    // Find the last assistant turn to check for inherited sources
    const lastAssistantTurn = [...priorTurns].reverse().find((t) => t.role === 'assistant');
    const priorTurnSources = (lastAssistantTurn?.sources as Source[]) ?? [];

    // Resolve source scope intelligently
    const resolvedScope = await resolveSourceScope({
      userId,
      message,
      requestedScope,
      priorTurns,
      priorTurnSources,
    });

    // 1. If scope requires clarification from the patient
    if (resolvedScope.clarification) {
      const clarification = resolvedScope.clarification;
      await persistTurn(userId, conversationId, 'assistant', clarification.question, []);

      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(sse({
            conversationId,
            clarification,
            content: clarification.question,
            scope: {
              mode: resolvedScope.mode,
              label: resolvedScope.label,
            },
          }));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      return new Response(readable, { headers: SSE_HEADERS });
    }

    // 2. If document is unavailable (e.g. pending processing or failed)
    if (resolvedScope.unavailableReason) {
      await persistTurn(userId, conversationId, 'assistant', resolvedScope.unavailableReason, []);

      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(sse({
            conversationId,
            content: resolvedScope.unavailableReason,
            scope: {
              mode: resolvedScope.mode,
              label: resolvedScope.label,
              documentIds: resolvedScope.documentIds,
            },
          }));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      return new Response(readable, { headers: SSE_HEADERS });
    }

    const scopeKey = `${resolvedScope.mode}:${(resolvedScope.documentIds || []).sort().join(',')}`;
    const fingerprint = await corpusFingerprint(userId);
    const cacheKey = getCacheKey(userId, message, fingerprint, scopeKey);

    // Only first turns are cacheable
    const cached = priorTurns.length === 0 ? getCachedResponse(cacheKey) : null;

    if (cached) {
      await persistTurn(userId, conversationId, 'assistant', cached.content, cached.sources);

      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(sse({
            conversationId,
            sources: cached.sources,
            scope: {
              mode: resolvedScope.mode,
              documentIds: resolvedScope.documentIds,
              label: resolvedScope.label,
            },
          }));
          controller.enqueue(sse({ content: cached.content }));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      return new Response(readable, { headers: SSE_HEADERS });
    }

    // Resolves pronouns and references into a standalone query
    const retrievalQuery = await rewriteForRetrieval(message, priorTurns);

    // Filter chunks strictly by resolvedScope.documentIds at retrieval layer
    const chunks = await retrieveRelevantChunks(userId, retrievalQuery, {
      documentIds: resolvedScope.documentIds,
    });

    const scopedDocIds = resolvedScope.documentIds;
    const isScoped = Boolean(scopedDocIds && scopedDocIds.length > 0);

    // Query structured medical records with scope applied
    const [medRows, allergyRows, [user]] = await Promise.all([
      getDb()
        .select({
          name: medications.name,
          genericName: medications.genericName,
          dosage: medications.dosage,
          frequency: medications.frequency,
          route: medications.route,
          prescribedDate: medications.prescribedDate,
          patientStatus: medications.patientStatus,
          observation: medications.observation,
          documentId: medications.documentId,
          documentTitle: documents.title,
        })
        .from(medications)
        .leftJoin(documents, eq(documents.id, medications.documentId))
        .where(
          and(
            eq(medications.userId, userId),
            eq(medications.sourceActive, true),
            isScoped ? inArray(medications.documentId, scopedDocIds!) : undefined
          )
        )
        .limit(PROFILE_LIMIT),
      getDb()
        .select()
        .from(allergies)
        .where(
          and(
            eq(allergies.userId, userId),
            isScoped ? or(inArray(allergies.documentId, scopedDocIds!), isNull(allergies.documentId)) : undefined
          )
        )
        .limit(PROFILE_LIMIT),
      getDb().select().from(users).where(eq(users.id, userId)).limit(1),
    ]);

    const userProfile = {
      medications: medRows.map((m) => {
        let status = 'prescribed_unconfirmed';
        if (m.patientStatus) {
          status = m.patientStatus;
        } else if ((m.observation as Record<string, unknown> | null)?.explicitStop) {
          status = 'discontinued';
        } else if (m.prescribedDate && Date.now() - new Date(m.prescribedDate).getTime() > 180 * 86400 * 1000) {
          status = 'historical';
        }

        return {
          name: m.name,
          genericName: m.genericName ?? undefined,
          dosage: m.dosage ?? undefined,
          frequency: m.frequency ?? undefined,
          route: m.route ?? undefined,
          status,
          prescribedDate: m.prescribedDate?.toISOString().split('T')[0],
          sourceDocumentTitle: m.documentTitle ?? undefined,
        };
      }),
      allergies: allergyRows.map((a) => ({
        allergen: a.allergen,
        allergyType: a.allergyType ?? undefined,
        severity: a.severity ?? undefined,
        reaction: a.reaction ?? undefined,
      })),
      conditions: (user?.knownConditions as string[]) ?? [],
    };

    // 3. Explicit insufficient evidence handling for scoped search when no chunks and no relevant profile records exist
    if (isScoped && chunks.length === 0 && userProfile.medications.length === 0 && userProfile.allergies.length === 0) {
      const docNames = resolvedScope.documentTitles?.join(', ') || 'the selected document';
      const insufficientMsg = `I couldn't find any information answering your question in ${docNames}. No matching clinical notes, medications, or lab findings were documented in this source.\n\nYou can switch your search scope to "Complete Medical History" or select another document to search your wider health records.`;

      await persistTurn(userId, conversationId, 'assistant', insufficientMsg, []);

      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(sse({
            conversationId,
            sources: [],
            scope: {
              mode: resolvedScope.mode,
              documentIds: resolvedScope.documentIds,
              label: resolvedScope.label,
            },
          }));
          controller.enqueue(sse({ content: insufficientMsg }));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      return new Response(readable, { headers: SSE_HEADERS });
    }

    const sources: Source[] = chunks.map((c) => ({
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      documentType: c.documentType,
      section: c.section,
      relevanceScore: c.relevanceScore,
    }));

    let medicineCatalogReference: string | undefined;
    try {
      const pkLookup = await pakistanMedicationCatalogService.lookupMedication(message);
      if (pkLookup.source === 'pakistan_catalog' && pkLookup.genericName) {
        const ingStr = pkLookup.ingredients.map((i) => i.name + (i.strength ? ` (${i.strength})` : '')).join(' + ');
        medicineCatalogReference = `- Brand: ${pkLookup.brandName ?? message}\n- Generic Ingredients: ${ingStr}\n- Manufacturer: ${pkLookup.manufacturer ?? 'Unknown'}\n- Available Form: ${pkLookup.dosageForm ?? 'N/A'}`;
      }
    } catch {
      // ignore
    }

    const promptMessages = buildQaPrompt(
      message,
      chunks,
      userProfile,
      priorTurns,
      {
        mode: resolvedScope.mode,
        documentTitles: resolvedScope.documentTitles,
        label: resolvedScope.label,
      },
      medicineCatalogReference
    );

    const stream = await streamAnswer(promptMessages);

    let fullResponse = '';

    const readable = new ReadableStream({
      async start(controller) {
        controller.enqueue(sse({
          conversationId,
          sources,
          scope: {
            mode: resolvedScope.mode,
            documentIds: resolvedScope.documentIds,
            label: resolvedScope.label,
          },
        }));

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
