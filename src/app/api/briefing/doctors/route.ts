import { NextRequest, NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { getCurrentUserId } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { errorResponse, ApiError } from '@/lib/api-error';
import { getDb } from '@/lib/db';
import { patientDoctors, documents } from '../../../../../drizzle/schema';
import { buildDoctorProfiles, normalizeDoctorName } from '@/services/briefing/doctor-tracker';

const createDoctorSchema = z.object({
  name: z.string().trim().min(2, 'Doctor name must be at least 2 characters').max(255),
  specialty: z.string().trim().max(255).optional().nullable(),
  hospital: z.string().trim().max(500).optional().nullable(),
  contactInfo: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  sourceDocumentId: z.string().uuid().optional().nullable(),
});

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    consume('read', userId);

    const [docs, pDoctors] = await Promise.all([
      getDb()
        .select({
          id: documents.id,
          title: documents.title,
          doctorName: documents.doctorName,
          hospital: documents.hospital,
          documentDate: documents.documentDate,
          documentType: documents.documentType,
          rawExtractedText: documents.rawExtractedText,
        })
        .from(documents)
        .where(eq(documents.userId, userId))
        .orderBy(desc(documents.documentDate))
        .limit(200),
      getDb()
        .select()
        .from(patientDoctors)
        .where(eq(patientDoctors.userId, userId))
        .orderBy(desc(patientDoctors.updatedAt)),
    ]);

    const profiles = buildDoctorProfiles(docs, pDoctors);
    return NextResponse.json(profiles);
  } catch (error) {
    return errorResponse('GET /api/briefing/doctors', error, 'Failed to list doctors');
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    consume('settings', userId);

    const body = await request.json();
    const parsed = createDoctorSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid doctor data');
    }

    const { name, specialty, hospital, contactInfo, notes, sourceDocumentId } = parsed.data;
    const normalizedName = normalizeDoctorName(name);

    const [created] = await getDb()
      .insert(patientDoctors)
      .values({
        userId,
        name,
        normalizedName,
        specialty: specialty ?? null,
        hospital: hospital ?? null,
        contactInfo: contactInfo ?? null,
        notes: notes ?? null,
        sourceType: 'patient_entered',
        sourceDocumentId: sourceDocumentId ?? null,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return errorResponse('POST /api/briefing/doctors', error, 'Failed to save doctor information');
  }
}
