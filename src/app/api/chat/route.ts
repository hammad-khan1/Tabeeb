import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { retrieveRelevantChunks } from '@/services/rag/retriever';
import { buildQaPrompt } from '@/services/rag/prompt-builder';
import { streamAnswer } from '@/services/rag/answer-streamer';
import { medications, allergies, users, chatMessages } from '../../../../drizzle/schema';

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

    const chunks = await retrieveRelevantChunks(userId, message);

    const [meds, allergyRows, [user]] = await Promise.all([
      getDb().select().from(medications).where(eq(medications.userId, userId)),
      getDb().select().from(allergies).where(eq(allergies.userId, userId)),
      getDb().select().from(users).where(eq(users.id, userId)).limit(1),
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

          // Persist both messages after streaming completes
          try {
            await getDb().insert(chatMessages).values([
              {
                userId,
                conversationId,
                role: 'user',
                content: message,
              },
              {
                userId,
                conversationId,
                role: 'assistant',
                content: fullResponse,
                sources: sources.length > 0 ? sources : null,
              },
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
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Chat failed';
    console.error('[POST /api/chat]', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
