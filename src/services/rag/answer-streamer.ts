import { getGroq, MODELS } from '@/lib/groq';

interface StreamMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function streamAnswer(messages: StreamMessage[]) {
  const stream = await getGroq().chat.completions.create({
    model: MODELS.primary,
    messages,
    temperature: 0,
    seed: 42,
    max_tokens: 2048,
    stream: true,
  });

  return stream;
}
