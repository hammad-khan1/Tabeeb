import type { Metadata } from 'next';
import { format } from 'date-fns';
import { AlertTriangle, Building2, FlaskConical, Pill, Stethoscope } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DOCUMENT_TYPE_LABELS } from '@/lib/constants';
import { getSharedHistory, type SharedHistoryData } from '@/services/history/share';

/**
 * Public by design — this page is what a patient hands to a doctor, so it must render
 * without a session. It sits outside the (authenticated) group and outside the
 * protected matcher in proxy.ts.
 *
 * A server component rather than a client fetch: the token never needs to reach the
 * browser's JS, and the previous client version was reading a response shape the API
 * did not return, so it could not have rendered.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared medical record',
  // Shared records must never be indexed.
  robots: { index: false, follow: false, nocache: true },
};

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : format(date, 'd MMM yyyy');
}

function Unavailable({ message }: { message: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            Link unavailable
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{message}</p>
          <p className="text-muted-foreground text-sm mt-3">
            Ask the person who sent it to generate a new link.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
          <span className="ml-auto text-sm font-normal text-muted-foreground tabular-nums">
            {count}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function SharedRecordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let data: SharedHistoryData;
  try {
    data = await getSharedHistory(token);
  } catch (error) {
    return (
      <Unavailable
        message={
          error instanceof Error
            ? error.message
            : 'This link is no longer available.'
        }
      />
    );
  }

  const { history } = data;

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Shared medical record
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            {data.title ?? 'Medical record summary'}
          </h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              {history.documentCount} document{history.documentCount === 1 ? '' : 's'}
            </span>
            <span>Link expires {formatDate(data.expiresAt)}</span>
            <span>
              Viewed {data.viewCount} time{data.viewCount === 1 ? '' : 's'}
            </span>
          </div>
        </header>

        {history.isPartial && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <strong className="font-medium">This is a partial record.</strong> The
            patient chose to share {history.documentCount} document
            {history.documentCount === 1 ? '' : 's'}, so medicines, diagnoses,
            allergies and results from their other documents are not shown here.
          </div>
        )}

        <Separator />

        <Section
          title="Allergies"
          icon={<AlertTriangle className="w-4 h-4 text-destructive" />}
          count={history.allergies.length}
        >
          <ul className="space-y-2">
            {history.allergies.map((allergy, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{allergy.allergen}</span>
                {allergy.severity && <Badge variant="destructive">{allergy.severity}</Badge>}
                {allergy.reaction && (
                  <span className="text-sm text-muted-foreground">{allergy.reaction}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Current medicines"
          icon={<Pill className="w-4 h-4" />}
          count={history.currentMedications.length}
        >
          <ul className="space-y-2">
            {history.currentMedications.map((med, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{med.name}</span>
                {med.genericName && med.genericName !== med.name && (
                  <span className="text-sm text-muted-foreground">({med.genericName})</span>
                )}
                <span className="text-sm text-muted-foreground">
                  {[med.dosage, med.frequency, med.route].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Conditions"
          icon={<Stethoscope className="w-4 h-4" />}
          count={history.conditions.length}
        >
          <ul className="space-y-2">
            {history.conditions.map((condition, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{condition.condition}</span>
                {condition.icd10Code && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {condition.icd10Code}
                  </span>
                )}
                {condition.severity && <Badge variant="secondary">{condition.severity}</Badge>}
                <span className="text-sm text-muted-foreground">
                  {formatDate(condition.diagnosedDate)}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Recent results"
          icon={<FlaskConical className="w-4 h-4" />}
          count={history.recentLabResults.length}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-4 font-medium">Test</th>
                  <th className="py-2 pr-4 font-medium">Result</th>
                  <th className="py-2 pr-4 font-medium">Reference</th>
                  <th className="py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {history.recentLabResults.map((lab, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-4">{lab.testName}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      <span className={lab.isAbnormal ? 'font-semibold text-destructive' : ''}>
                        {lab.value}
                        {lab.unit ? ` ${lab.unit}` : ''}
                      </span>
                      {lab.isAbnormal && (
                        <span className="ml-2 text-xs uppercase tracking-wide">abnormal</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground tabular-nums">
                      {lab.referenceRange ?? '—'}
                    </td>
                    <td className="py-2 text-muted-foreground tabular-nums">
                      {formatDate(lab.testDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Visits"
          icon={<Building2 className="w-4 h-4" />}
          count={history.visitTimeline.length}
        >
          <div className="space-y-4">
            {history.visitTimeline.map((group) => (
              <div key={group.month}>
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                  {group.month}
                </p>
                <ul className="space-y-1">
                  {group.events.map((event, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{event.title}</span>
                      <Badge variant="secondary">
                        {DOCUMENT_TYPE_LABELS[event.type] ?? event.type}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {[event.hospital, event.doctorName].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        {history.documentCount === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              This shared record contains no documents.
            </CardContent>
          </Card>
        )}

        <footer className="pt-4 text-xs text-muted-foreground border-t">
          Shared from Tabeeb. Extracted automatically from uploaded documents and not
          verified by a clinician — check anything clinically important against the
          original records.
        </footer>
      </div>
    </main>
  );
}
