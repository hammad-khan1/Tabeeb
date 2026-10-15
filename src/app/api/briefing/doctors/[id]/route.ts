import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { getCurrentUserId } from '@/lib/auth';
import { consume } from '@/lib/rate-limit';
import { errorResponse, notFound, ApiError } from '@/lib/api-error';
import { getDb } from '@/lib/db';
import { patientDoctors } from '../../../../../../drizzle/schema';
import { normalizeDoctorName } from '@/services/briefing/doctor-tracker';

const updateDoctorSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  specialty: z.string().trim().max(255).optional().nullable(),
  hospital: z.string().trim().max(500).optional().nullable(),
  contactInfo: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  sourceType: z.enum(['extracted', 'patient_entered', 'verified']).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    consume('settings', userId);

    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateDoctorSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid update data');
    }

    const updates: Partial<typeof patientDoctors.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (parsed.data.name) {
      updates.name = parsed.data.name;
      updates.normalizedName = normalizeDoctorName(parsed.data.name);
    }
    if (parsed.data.specialty !== undefined) updates.specialty = parsed.data.specialty;
    if (parsed.data.hospital !== undefined) updates.hospital = parsed.data.hospital;
    if (parsed.data.contactInfo !== undefined) updates.contactInfo = parsed.data.contactInfo;
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
    if (parsed.data.sourceType) updates.sourceType = parsed.data.sourceType;

    const [updated] = await getDb()
      .update(patientDoctors)
      .set(updates)
      .where(and(eq(patientDoctors.id, id), eq(patientDoctors.userId, userId)))
      .returning();

    if (!updated) {
      throw notFound('Doctor record not found');
    }

    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse('PATCH /api/briefing/doctors/[id]', error, 'Failed to update doctor');
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    consume('settings', userId);

    const { id } = await context.params;

    const [deleted] = await getDb()
      .delete(patientDoctors)
      .where(and(eq(patientDoctors.id, id), eq(patientDoctors.userId, userId)))
      .returning({ id: patientDoctors.id });

    if (!deleted) {
      throw notFound('Doctor record not found');
    }

    return NextResponse.json({ success: true, id: deleted.id });
  } catch (error) {
    return errorResponse('DELETE /api/briefing/doctors/[id]', error, 'Failed to delete doctor');
  }
}
