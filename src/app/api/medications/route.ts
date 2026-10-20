import { NextRequest } from 'next/server';
import { parseOrThrow } from '@/lib/validation';
import { medicationListQuery, medicationRoute } from '@/services/medications/api';
import { getMedicationWorkspace, paginate } from '@/services/medications/workspace';
import { medicationStatus } from '@/services/medications/reconciliation';
import { MEDICATION_STATUSES, type MedicationStatus } from '@/services/medications/types';

export async function GET(request: NextRequest) {
  return medicationRoute(async (userId) => {
    const query = parseOrThrow(medicationListQuery, Object.fromEntries(request.nextUrl.searchParams));
    const workspace = await getMedicationWorkspace(userId);
    const records = workspace.medications.filter((row) => row.sourceActive);
    const counts = Object.fromEntries(MEDICATION_STATUSES.map((status) => [status, 0])) as Record<MedicationStatus, number>;
    for (const row of records) counts[medicationStatus(row)]++;
    const search = query.search.toLowerCase();
    const filtered = records.filter((row) =>
      (query.status === 'all' || medicationStatus(row) === query.status) &&
      (!search || [row.name, row.corrections?.name, row.genericName, row.observation?.normalization?.normalizedName,
        row.observation?.instructions, row.corrections?.instructions]
        .some((name) => name?.toLowerCase().includes(search)))
    );
    const page = paginate(filtered, query.page, query.pageSize);
    return {
      medications: page.items.map((row) => ({ ...row, effectiveStatus: medicationStatus(row) })),
      pagination: page.pagination, counts, documents: workspace.documents,
      medicationOptions: records.map((row) => ({
        id: row.id, name: row.corrections?.name || row.name, status: medicationStatus(row),
      })),
      interactionCheck: workspace.evaluation.interactionCoverage,
      limitations: workspace.limitations, truncated: workspace.truncated,
    };
  });
}
