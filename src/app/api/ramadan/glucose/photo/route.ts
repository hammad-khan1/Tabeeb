import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { badRequest, errorResponse } from '@/lib/api-error';
import { consume } from '@/lib/rate-limit';
import { ocrImage } from '@/services/text-extractors/image-extractor';
import { logGlucose } from '@/services/ramadan/glucose-log';
import { getCurrentPlan } from '@/services/ramadan/plan';

export const maxDuration = 60;

/** A glucometer photo is small; anything bigger is not one. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Reads a glucometer photo through the existing vision OCR, then the usual parser. The
 * number came from a vision model, so it is never stored until the patient confirms it.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('upload', userId);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw badRequest('Expected a multipart form upload.');
    }

    const file = formData.get('photo');
    if (!(file instanceof File) || file.size === 0) throw badRequest('No photo provided');
    if (file.size > MAX_PHOTO_BYTES) throw badRequest('The photo is too large. Maximum size is 10MB.');

    const mime = (file.type || '').toLowerCase().split(';')[0].trim();
    if (!mime.startsWith('image/')) throw badRequest('Please send a photo of your meter.');

    const ocr = await ocrImage(Buffer.from(await file.arrayBuffer()), mime);
    const plan = await getCurrentPlan(userId);
    const outcome = await logGlucose(
      userId,
      plan,
      { text: ocr.text, symptoms: [], source: 'photo', confirmed: false },
      { alwaysConfirm: true }
    );

    return NextResponse.json(outcome);
  } catch (error) {
    return errorResponse('POST /api/ramadan/glucose/photo', error, 'Failed to read the photo');
  }
}
