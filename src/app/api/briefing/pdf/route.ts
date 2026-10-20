import { NextRequest } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { badRequest, errorResponse } from '@/lib/api-error';
import { parseOrThrow } from '@/lib/validation';
import { briefingFilterSchema } from '@/services/briefing/filter-schema';
import { generatePatientBriefing } from '@/services/briefing/briefing-generator';
import { generateBriefingPdf } from '@/services/briefing/pdf-generator';

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);

    let body: unknown = {};
    try {
      const text = await request.text();
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw badRequest('Invalid JSON request body.');
    }

    const briefing = await generatePatientBriefing(userId, parseOrThrow(briefingFilterSchema, body));

    const pdfBuffer = generateBriefingPdf(briefing);

    return new Response(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="tabeeb-patient-briefing.pdf"',
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  } catch (error) {
    return errorResponse('POST /api/briefing/pdf', error, 'Failed to generate PDF export');
  }
}
