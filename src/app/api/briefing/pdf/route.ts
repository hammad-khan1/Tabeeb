import { NextRequest } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-error';
import { generatePatientBriefing } from '@/services/briefing/briefing-generator';
import { generateBriefingPdf } from '@/services/briefing/pdf-generator';

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);

    let body: { from?: string | null; to?: string | null; documentIds?: string[] } = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is fine, falls back to full record
    }

    const briefing = await generatePatientBriefing(userId, {
      from: body.from ?? undefined,
      to: body.to ?? undefined,
      documentIds: body.documentIds,
    });

    const pdfBuffer = generateBriefingPdf(briefing);

    return new Response(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="tabeeb-patient-briefing.pdf"',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    return errorResponse('POST /api/briefing/pdf', error, 'Failed to generate PDF export');
  }
}
