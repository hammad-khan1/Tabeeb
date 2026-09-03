import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse } from '@/lib/api-error';
import { transcribeAudio } from '@/services/voice/transcriber';
import { structureVoiceEntry } from '@/services/voice/structurer';

export async function POST(request: NextRequest) {
  try {
    await getCurrentUserId();

    const formData = await request.formData();
    const file = formData.get('audio') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const transcription = await transcribeAudio(buffer, file.name);

    if (!transcription.text || transcription.text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Could not transcribe audio. Please try again with clearer audio.' },
        { status: 422 }
      );
    }

    const structuredEntry = await structureVoiceEntry(transcription.text);

    return NextResponse.json({
      transcript: transcription.text,
      language: transcription.language,
      duration: transcription.duration,
      structuredEntry,
    });
  } catch (error) {
    return errorResponse('POST /api/voice/transcribe', error, 'Transcription failed');
  }
}
