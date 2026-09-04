import { getGroq, MODELS } from '@/lib/groq';

/**
 * Turns a follow-up into a standalone question before retrieval.
 *
 * The chat had no conversational memory: the client sent only the latest message and
 * the server retrieved on it verbatim. "What about the second one?" was embedded as
 * literally that, so it retrieved against a pronoun and the answer came back cold.
 *
 * Rewriting happens before retrieval and only affects retrieval — the model still
 * sees the patient's own wording in the prompt, so the reply matches how they asked.
 */

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Enough context to resolve a reference without paying for the whole thread. */
const MAX_HISTORY_TURNS = 6;
const MAX_TURN_CHARS = 600;

const REWRITE_PROMPT = `Rewrite the user's latest message into a standalone search query for a medical records search engine.

Rules:
- Resolve pronouns and references from the conversation: "what about the second one" becomes the thing it refers to.
- Keep the medical terms, drug names, test names and numbers exactly as written. Never translate or correct them.
- If the latest message is already standalone, return it unchanged.
- Output ONLY the rewritten query, with no preamble, quotes or explanation.
- Keep it under 40 words.`;

function isLikelyStandalone(message: string): boolean {
  const trimmed = message.trim();

  // Long questions carry their own context; rewriting them costs a call for nothing.
  if (trimmed.length > 140) return true;

  // The cheap signal for a follow-up: a referring expression, or no content word at
  // all ("and the dose?").
  const referring =
    /\b(?:it|its|it's|that|this|those|these|they|them|their|the (?:first|second|third|last|other|same|previous)|there|then|he|she|his|her|same|above|earlier|before)\b/i;
  const continuation = /^\s*(?:and|but|so|also|what about|how about|why|ok|okay|then)\b/i;

  return !referring.test(trimmed) && !continuation.test(trimmed);
}

function formatHistory(history: ConversationTurn[]): string {
  return history
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => {
      const speaker = turn.role === 'user' ? 'Patient' : 'Assistant';
      const content =
        turn.content.length > MAX_TURN_CHARS
          ? `${turn.content.slice(0, MAX_TURN_CHARS)}…`
          : turn.content;
      return `${speaker}: ${content}`;
    })
    .join('\n');
}

/**
 * Never throws and never blocks the answer: a rewrite failure falls back to the
 * original message, which is exactly the old behaviour.
 */
export async function rewriteForRetrieval(
  message: string,
  history: ConversationTurn[]
): Promise<string> {
  if (history.length === 0) return message;
  if (isLikelyStandalone(message)) return message;

  try {
    const response = await getGroq().chat.completions.create({
      model: MODELS.fast,
      messages: [
        { role: 'system', content: REWRITE_PROMPT },
        {
          role: 'user',
          content: `Conversation so far:\n${formatHistory(history)}\n\nLatest message: ${message}\n\nStandalone query:`,
        },
      ],
      temperature: 0,
      max_tokens: 120,
    });

    const rewritten = response.choices[0]?.message?.content?.trim();
    if (!rewritten) return message;

    // Guard against a model that answers the question instead of rewriting it.
    const stripped = rewritten.replace(/^["'`]|["'`]$/g, '').trim();
    if (!stripped || stripped.length > 400) return message;

    return stripped;
  } catch (error) {
    console.warn(
      '[QueryRewriter] falling back to the raw message:',
      error instanceof Error ? error.message : error
    );
    return message;
  }
}
