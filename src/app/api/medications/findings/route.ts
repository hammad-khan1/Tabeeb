import { NextRequest } from 'next/server';
import { parseOrThrow } from '@/lib/validation';
import { findingQuery, medicationRoute } from '@/services/medications/api';
import { getMedicationWorkspace, paginate } from '@/services/medications/workspace';

export async function GET(request: NextRequest) {
  return medicationRoute(async (userId) => {
    const query = parseOrThrow(findingQuery, Object.fromEntries(request.nextUrl.searchParams));
    const workspace = await getMedicationWorkspace(userId);
    const findings = workspace.findings.filter((row) =>
      (query.history === '1' || row.current) &&
      (query.status === 'all' || row.reviewStatus === query.status) &&
      (query.category === 'all' || row.category === query.category)
    );
    const page = paginate(findings, query.page, query.pageSize);
    return { findings: page.items, pagination: page.pagination, limitations: workspace.limitations };
  });
}
