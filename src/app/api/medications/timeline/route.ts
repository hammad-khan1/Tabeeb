import { NextRequest } from 'next/server';
import { parseOrThrow } from '@/lib/validation';
import { medicationRoute, timelineQuery } from '@/services/medications/api';
import { getMedicationWorkspace, isCurrentMedicationStatus, paginate } from '@/services/medications/workspace';
import { medicationStatus } from '@/services/medications/reconciliation';

export async function GET(request: NextRequest) {
  return medicationRoute(async (userId) => {
    const query = parseOrThrow(timelineQuery, Object.fromEntries(request.nextUrl.searchParams));
    const workspace = await getMedicationWorkspace(userId);
    const allowed = new Set(workspace.medications.filter((row) => query.view === 'all' ||
      (isCurrentMedicationStatus(medicationStatus(row)) === (query.view === 'current')))
      .map((row) => row.id));
    const events = workspace.events.filter((event) =>
      (!query.medicationId || query.medicationId === 'all' || event.medicationIds.includes(query.medicationId)) &&
      event.medicationIds.some((id) => allowed.has(id))
    );
    const page = paginate(events, query.page, query.pageSize);
    return { events: page.items, pagination: page.pagination, limitations: workspace.limitations };
  });
}
