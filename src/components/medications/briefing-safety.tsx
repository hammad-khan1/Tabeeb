"use client";

import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import type { MedicationCorrections, MedicationEvaluation, MedicationStatus } from '@/services/medications/types';
import { ProviderCoverage } from './provider-coverage';
import { EvidenceList } from './shared';

export function MedicationUseStatus({ status }: { status?: MedicationStatus }) {
  const { t } = useLocale();
  return <Badge variant="outline" className="mt-1 text-[10px]">{t(`medications.${status ?? 'prescribed_unconfirmed'}`)}</Badge>;
}

export function PatientReportedValues({ corrections }: { corrections?: MedicationCorrections }) {
  const { t } = useLocale();
  if (!corrections || Object.keys(corrections).length === 0) return null;
  return <div className="mt-2 space-y-1 rounded border p-2 text-xs">
    <p className="font-medium">{t('medications.patientReported')}</p>
    {(Object.entries(corrections) as Array<[keyof MedicationCorrections, string | null]>).map(([key, value]) => <p key={key} className="break-words"><span className="text-muted-foreground">{t(`medications.${key}`)}: </span><bdi>{value || t('medications.notDocumented')}</bdi></p>)}
  </div>;
}

/** Read-only; sharing code must pass its scoped source URL resolver. */
export function BriefingMedicationSafety({ evaluation, sourceHref }: {
  evaluation?: MedicationEvaluation | null;
  sourceHref?: (documentId: string | null, page: number | null) => string | null;
}) {
  const { t } = useLocale();
  if (!evaluation) return <p className="text-sm text-muted-foreground">{t('medications.summaryUnavailable')}</p>;
  const findings = evaluation.findings.filter((finding) => finding.current);
  const changes = evaluation.timeline.filter((event) => !['first_documented', 'safety_finding'].includes(event.type));
  const displayedFindings = findings.slice(0, 20);
  const displayedChanges = changes.slice(0, 20);
  return (
    <section className="space-y-4" aria-label={t('nav.medications')}>
      <h3 className="text-base font-semibold">{t('nav.medications')}</h3>
      <p className="text-sm text-muted-foreground">{t('medications.guidance')}</p>
      <ProviderCoverage coverage={evaluation.interactionCoverage} limitations={evaluation.limitations} />
      <section className="space-y-3">
        <h4 className="font-medium">{t('medications.findings')} ({findings.length})</h4>
        {findings.length === 0 && <p className="text-sm text-muted-foreground">{t('medications.noFindings')}</p>}
        {displayedFindings.map((finding) => <article key={finding.id} className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{t(`medications.${finding.category}`)}</Badge><Badge variant="outline">{t(`medications.${finding.reviewStatus}`)}</Badge></div>
          <h5 className="text-sm font-medium">{finding.title}</h5>
          <p className="text-sm text-muted-foreground">{finding.explanation}</p>
          <p className="text-xs text-muted-foreground">{t('medications.certainty')}: {t(`medications.${finding.certainty}`)}{finding.severity ? ` · ${t('medications.severity')}: ${finding.severity}` : ''}</p>
          {finding.knowledgeSource && <p className="text-xs text-muted-foreground">{finding.knowledgeSource.provider} · {finding.knowledgeSource.version || t('medications.notDocumented')} · {finding.knowledgeSource.checkedAt || t('medications.dateUnknown')}</p>}
          <details><summary className="cursor-pointer text-xs text-primary">{t('medications.source')}</summary><div className="mt-2"><EvidenceList evidence={finding.evidence} sourceHref={sourceHref} /></div></details>
        </article>)}
        {findings.length > displayedFindings.length && <p className="text-xs text-muted-foreground">{t('medications.showing')} {displayedFindings.length} {t('medications.of')} {findings.length}</p>}
      </section>
      {changes.length > 0 && <section className="space-y-3">
        <h4 className="font-medium">{t('medications.timeline')} ({changes.length})</h4>
        <ol className="space-y-3">{displayedChanges.map((event) => <li key={event.id} className="space-y-2 border-s-2 ps-3">
          <p className="text-xs text-muted-foreground">{event.date || t('medications.dateUnknown')} · {t(`medications.${event.confirmation}`)}</p>
          <p className="text-sm font-medium">{event.title}</p>
          <p className="text-sm text-muted-foreground">{event.description}</p>
          <details><summary className="cursor-pointer text-xs text-primary">{t('medications.source')}</summary><div className="mt-2"><EvidenceList evidence={event.evidence} sourceHref={sourceHref} /></div></details>
        </li>)}</ol>
        {changes.length > displayedChanges.length && <p className="text-xs text-muted-foreground">{t('medications.showing')} {displayedChanges.length} {t('medications.of')} {changes.length}</p>}
      </section>}
    </section>
  );
}
