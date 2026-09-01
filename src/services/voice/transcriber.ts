import { groq, MODELS } from '@/lib/groq';

export interface TranscriptionResult {
  text: string;
  language: string;
  duration: number;
}

interface VerboseTranscription {
  text: string;
  language?: string;
  duration?: number;
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  fileName: string
): Promise<TranscriptionResult> {
  const file = new File([new Uint8Array(audioBuffer)], fileName);

  const response = await groq.audio.transcriptions.create({
    file,
    model: MODELS.whisper,
    response_format: 'verbose_json',
  });

  const verbose = response as unknown as VerboseTranscription;

  return {
    text: response.text,
    language: verbose.language ?? 'unknown',
    duration: verbose.duration ?? 0,
  };
}
