/**
 * Turns a spoken answer to one risk question into one of that question's options.
 *
 * The model chooses from the question's own option ids, through a schema that accepts
 * nothing else, and may say none fits. Its choice is a suggestion: the screen
 * highlights it and the patient taps to confirm, so a misheard answer never enters the
 * score by itself.
 */

import { z } from 'zod';
import { getGroq, MODELS } from '@/lib/groq';
import { RISK_ITEMS, type RiskItemId } from './constants';

export type OptionChooser = (prompt: string, transcript: string) => Promise<unknown>;

async function groqChooser(prompt: string, transcript: string): Promise<unknown> {
  const response = await getGroq().chat.completions.create({
    model: MODELS.fast,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: transcript },
    ],
    temperature: 0,
    max_tokens: 60,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from answer interpreter');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('Answer interpreter returned malformed JSON');
  }
}

export async function interpretVoiceAnswer(
  itemId: RiskItemId,
  transcript: string,
  choose: OptionChooser = groqChooser
): Promise<string | null> {
  const item = RISK_ITEMS.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Unknown risk item: ${itemId}`);

  const ids = item.options.map((option) => option.id) as [string, ...string[]];
  const schema = z.object({ option: z.enum(ids).nullable() });

  const prompt = `A patient is answering a question by voice, in English, Urdu or Roman Urdu.
Question: "${item.label}"
Options (id: meaning):
${item.options.map((option) => `- ${option.id}: ${option.label}`).join('\n')}

Return JSON {"option": "<id>"} for the option the patient's words clearly state, or {"option": null} if they do not clearly match exactly one. Never guess.`;

  const parsed = schema.safeParse(await choose(prompt, transcript));
  return parsed.success ? parsed.data.option : null;
}
