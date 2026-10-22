import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseJsonBody } from '@/lib/validation';
import { synthesizeSpeech } from '@/services/speech/tts-provider';

export const maxDuration = 60;

const synthesizeSchema = z.object({
  text: z.string().trim().min(1, 'Text cannot be empty').max(8000, 'Text exceeds maximum length'),
  lang: z.enum(['en', 'ur']),
});

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('chat', userId);

    const data = await parseJsonBody(synthesizeSchema, request);

    const { buffer, mimeType } = await synthesizeSpeech(
      data.text,
      data.lang
    );

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    return errorResponse('POST /api/speech/synthesize', error, 'Speech synthesis failed');
  }
}
