import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseJsonBody } from '@/lib/validation';
import { translateMedicalTextToUrdu } from '@/services/speech/translator';

export const maxDuration = 60;

const translateSchema = z.object({
  text: z.string().trim().min(1, 'Text cannot be empty').max(8000, 'Text exceeds maximum length'),
});

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('chat', userId);

    const data = await parseJsonBody(translateSchema, request);
    const translatedText = await translateMedicalTextToUrdu(data.text);

    return NextResponse.json({
      translatedText,
      language: 'ur',
    });
  } catch (error) {
    return errorResponse('POST /api/speech/translate', error, 'Translation failed');
  }
}
