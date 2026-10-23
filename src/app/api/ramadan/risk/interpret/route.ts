import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { parseJsonBody, voiceAnswerSchema } from '@/lib/validation';
import type { RiskItemId } from '@/services/ramadan/constants';
import { interpretVoiceAnswer } from '@/services/ramadan/voice-answer';

/**
 * A spoken answer (already transcribed by /api/voice/transcribe) to one risk question,
 * matched to one of its options. A suggestion only: nothing is saved here.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('transcribe', userId);

    const { item, transcript } = await parseJsonBody(voiceAnswerSchema, request);
    const option = await interpretVoiceAnswer(item as RiskItemId, transcript);
    return NextResponse.json({ item, option });
  } catch (error) {
    return errorResponse('POST /api/ramadan/risk/interpret', error, 'Failed to read the answer');
  }
}
