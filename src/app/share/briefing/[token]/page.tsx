import type { Metadata } from 'next';
import { format } from 'date-fns';
import {
  AlertTriangle,
  Building2,
  FlaskConical,
  HelpCircle,
  Pill,
  ShieldAlert,
  Stethoscope,
  TrendingDown,
  TrendingUp,
  UserCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getSharedBriefing, type SharedBriefingData } from '@/services/briefing/share';
import { BriefingPrintButton } from './print-button';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Doctor-Ready Patient Briefing — Tabeeb',
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
      <Card className="max-w-md w-full border-destructive/30 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-destructive">
            <AlertTriangle className="size-5" aria-hidden="true" />
            Briefing Link Unavailable
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{message}</p>
          <p className="text-xs text-muted-foreground/80">
            For patient privacy and security, access expires automatically or can be revoked by the patient at any time.
            Please request a fresh link from the patient.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

export default async function SharedBriefingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let data: SharedBriefingData;
  try {
    data = await getSharedBriefing(token);
  } catch (error) {
    return (
      <Unavailable
        message={
          error instanceof Error
            ? error.message
            : 'This doctor briefing is no longer available. It may have expired or been revoked.'
        }
      />
    );
  }

  const { briefing } = data;

  return (
    <main className="min-h-screen bg-slate-50/50 dark:bg-zinc-950 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Top Clinical Header */}
        <header className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary mb-2">
                <Stethoscope className="size-3.5" />
                Doctor-Ready Clinical Briefing
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                {data.title || 'Patient Health Briefing'}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Patient: <span className="font-medium text-foreground">{briefing.patient.name || 'Verified Patient'}</span> · Prepared for clinical review
              </p>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <BriefingPrintButton />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t text-xs text-muted-foreground">
            <div>
              <span className="block text-foreground font-semibold">Generated</span>
              {formatDate(briefing.generatedAt)}
            </div>
            <div>
              <span className="block text-foreground font-semibold">Covered Records</span>
              {briefing.documentCount} Document{briefing.documentCount === 1 ? '' : 's'}
            </div>
            <div>
              <span className="block text-foreground font-semibold">Link Expiration</span>
              {formatDate(data.expiresAt)}
            </div>
            <div>
              <span className="block text-foreground font-semibold">Access Count</span>
              {data.viewCount} view{data.viewCount === 1 ? '' : 's'}
            </div>
          </div>
        </header>

        {/* Clinical Summary Banner */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-1">
              Executive Clinical Digest
            </h2>
            <p className="text-sm leading-relaxed text-foreground/90">
              {briefing.clinicalSummary}
            </p>
          </CardContent>
        </Card>

        {/* 1. Potentially Conflicting Information & Treatment Discrepancies */}
        {briefing.treatmentConflicts.length > 0 && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-amber-900 dark:text-amber-400 flex items-center gap-2">
                <ShieldAlert className="size-5 text-amber-600 dark:text-amber-400" />
                Treatment Discrepancies & Duplicate Therapies Requiring Review ({briefing.treatmentConflicts.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {briefing.treatmentConflicts.map((conflict) => (
                <div key={conflict.id} className="p-3.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-background space-y-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{conflict.title}</span>
                    <Badge variant={conflict.severity === 'high' ? 'destructive' : 'secondary'} className="uppercase text-[10px]">
                      {conflict.severity} Priority
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">{conflict.description}</p>
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                    Suggested Action: {conflict.recommendation}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* 2. Attending Doctors & Care Team */}
        {briefing.doctors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserCheck className="size-4.5 text-primary" />
                Healthcare Professionals Involved in Care ({briefing.doctors.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-3">
                {briefing.doctors.map((doc) => (
                  <div key={doc.id} className="p-3.5 rounded-lg border bg-card/60 space-y-1.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-foreground">Dr. {doc.name}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {doc.sourceType === 'verified'
                          ? 'Verified'
                          : doc.sourceType === 'patient_entered'
                          ? 'Patient Entered'
                          : 'From Records'}
                      </Badge>
                    </div>
                    <p className="text-xs text-primary font-medium">{doc.specialty || 'General / Not Specified'}</p>
                    {doc.hospital && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Building2 className="size-3" />
                        {doc.hospital}
                      </p>
                    )}
                    {doc.contactInfo && (
                      <p className="text-xs text-muted-foreground">Contact: {doc.contactInfo}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 3. Current Medications & Prescribing Attribution */}
        {briefing.currentMedications.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Pill className="size-4.5 text-primary" />
                Current Medications & Prescribing Attribution ({briefing.currentMedications.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <th className="py-2.5 pe-4">Medication</th>
                      <th className="py-2.5 pe-4">Dosage / Instructions</th>
                      <th className="py-2.5 pe-4">Prescribing Doctor</th>
                      <th className="py-2.5">Source Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {briefing.currentMedications.map((med) => (
                      <tr key={med.id} className="hover:bg-muted/40 transition">
                        <td className="py-2.5 pe-4 font-medium text-foreground">
                          {med.name}
                          {med.genericName && (
                            <span className="block text-xs text-muted-foreground">({med.genericName})</span>
                          )}
                        </td>
                        <td className="py-2.5 pe-4 text-xs text-muted-foreground">
                          {[med.dosage, med.frequency, med.route].filter(Boolean).join(' · ') || 'As directed'}
                        </td>
                        <td className="py-2.5 pe-4 text-xs">
                          <span className={med.prescribingDoctor.isIdentified ? 'font-medium text-foreground' : 'italic text-muted-foreground'}>
                            {med.prescribingDoctor.name}
                          </span>
                          {med.prescribingDoctor.specialty && (
                            <span className="block text-[11px] text-muted-foreground">{med.prescribingDoctor.specialty}</span>
                          )}
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground">
                          {med.sourceCitation}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 4. Laboratory Trends & Recent Results */}
        {briefing.labTrends.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FlaskConical className="size-4.5 text-primary" />
                Laboratory Test Results & Longitudinal Trends ({briefing.labTrends.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <th className="py-2.5 pe-4">Analyte / Test</th>
                      <th className="py-2.5 pe-4">Latest Value</th>
                      <th className="py-2.5 pe-4">Reference Range</th>
                      <th className="py-2.5 pe-4">Trend</th>
                      <th className="py-2.5">Clinical Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {briefing.labTrends.map((trend, i) => (
                      <tr key={i} className="hover:bg-muted/40 transition">
                        <td className="py-2.5 pe-4 font-medium text-foreground">
                          {trend.testName}
                        </td>
                        <td className="py-2.5 pe-4 text-xs font-semibold tabular-nums">
                          <span className={trend.latestIsAbnormal ? 'text-destructive font-bold' : 'text-foreground'}>
                            {trend.latestValue} {trend.unit || ''}
                          </span>
                          {trend.latestIsAbnormal && (
                            <span className="ms-1.5 inline-block text-[10px] text-destructive uppercase border border-destructive/30 px-1 py-0.2 rounded">
                              Abnormal
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pe-4 text-xs text-muted-foreground tabular-nums">
                          {trend.referenceRange || '—'}
                        </td>
                        <td className="py-2.5 pe-4 text-xs">
                          {trend.direction === 'worsened' ? (
                            <span className="flex items-center gap-1 text-destructive font-medium">
                              <TrendingUp className="size-3.5" /> Worsened
                            </span>
                          ) : trend.direction === 'improved' ? (
                            <span className="flex items-center gap-1 text-emerald-600 font-medium">
                              <TrendingDown className="size-3.5" /> Improved
                            </span>
                          ) : trend.direction === 'stable' ? (
                            <span className="text-muted-foreground">Stable</span>
                          ) : (
                            <span className="text-muted-foreground capitalize">{trend.direction.replace('_', ' ')}</span>
                          )}
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground">
                          {trend.clinicalNote}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 5. Documented Conditions & Diagnoses */}
        {briefing.conditions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Stethoscope className="size-4.5 text-primary" />
                Medical Conditions & Diagnoses ({briefing.conditions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {briefing.conditions.map((c) => (
                  <li key={c.id} className="py-2.5 flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="font-semibold text-foreground">{c.condition}</span>
                      {c.icd10Code && (
                        <span className="ms-2 font-mono text-xs text-muted-foreground">({c.icd10Code})</span>
                      )}
                      {c.diagnosingDoctor && (
                        <span className="ms-2 text-xs text-muted-foreground">· Diagnosed by {c.diagnosingDoctor}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {c.severity && <Badge variant="secondary">{c.severity}</Badge>}
                      <span>{formatDate(c.diagnosedDate)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* 6. Known Allergies */}
        {briefing.allergies.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="size-4.5 text-destructive" />
                Allergies & Sensitivities ({briefing.allergies.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {briefing.allergies.map((a, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{a.allergen}</span>
                    {a.severity && <Badge variant="destructive">{a.severity}</Badge>}
                    {a.reaction && <span className="text-xs text-muted-foreground">({a.reaction})</span>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* 7. Suggested Questions for Consultation */}
        {briefing.consultationQuestions.length > 0 && (
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-primary">
                <HelpCircle className="size-4.5" />
                Discussion Points for Healthcare Professional ({briefing.consultationQuestions.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {briefing.consultationQuestions.map((q) => (
                <div key={q.id} className="p-3 rounded-lg border bg-background space-y-1 text-sm">
                  <p className="font-medium text-foreground">“{q.question}”</p>
                  <p className="text-xs text-muted-foreground">Clinical context: {q.rationale}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Disclaimer Footer */}
        <footer className="pt-6 border-t text-xs text-muted-foreground space-y-2 text-center">
          <p>
            Generated via <strong>Tabeeb 2.0 AI Health Companion</strong>. Designed to assist clinical review and communication.
            All statements are extracted from patient-provided medical documents and are not independently verified by a licensed clinician.
            Always confirm active medications and critical laboratory values against source hospital records.
          </p>
        </footer>
      </div>
    </main>
  );
}
