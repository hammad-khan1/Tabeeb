import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { errorResponse, badRequest, ApiError } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { transcribeAudio } from '@/services/voice/transcriber';
import { structureVoiceEntry } from '@/services/voice/structurer';

export const maxDuration = 120;

/** Groq's Whisper endpoint caps uploads at 25MB. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const SUPPORTED_AUDIO = new Set([
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/mp4',
  'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/flac',
  'video/webm', // MediaRecorder labels webm audio this way in some browsers
]);

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('transcribe', userId);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw badRequest('Expected a multipart form upload.');
    }

    const file = formData.get('audio');
    if (!(file instanceof File)) {
      throw badRequest('No audio file provided');
    }
    if (file.size === 0) {
      throw badRequest('The recording is empty.');
    }
    if (file.size > MAX_AUDIO_BYTES) {
      throw badRequest('The recording is too long. Maximum size is 25MB.');
    }

    const mime = (file.type || '').toLowerCase().split(';')[0].trim();
    if (mime && !SUPPORTED_AUDIO.has(mime)) {
      throw badRequest(`Audio format "${mime}" is not supported.`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const transcription = await transcribeAudio(buffer, file.name || 'recording.webm');

    if (!transcription.text.trim()) {
      throw new ApiError(
        422,
        'Could not transcribe audio. Please try again with clearer audio.'
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
