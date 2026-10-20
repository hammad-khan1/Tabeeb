"use client";

import { useState, type FormEvent } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/providers/locale-provider';
import type { FindingCategory, FindingReviewStatus, SafetyFinding } from '@/services/medications/types';
import type { TranslationKey } from '@/lib/i18n';
import type { MedicationFindingsResponse } from './api-types';
import { EvidenceList, LoadingMedicationData, MedicationError, MedicationSelect, Pagination, medicationFetcher, saveMedicationUpdate, selectClassName } from './shared';

const categoryKeys: Record<FindingCategory, TranslationKey> = {
  allergy_concern: 'medications.allergy_concern',
  drug_interaction: 'medications.drug_interaction',
  exact_duplicate: 'medications.exact_duplicate',
  ingredient_duplication: 'medications.ingredient_duplication',
  therapeutic_duplication: 'medications.therapeutic_duplication',
  conflicting_instructions: 'medications.conflicting_instructions',
  missing_information: 'medications.missing_information',
  uncertain_identity: 'medications.uncertain_identity',
  reconciliation_difference: 'medications.reconciliation_difference',
};
const reviewStatuses: FindingReviewStatus[] = ['open', 'needs_verification', 'reviewed', 'resolved', 'dismissed'];

export function FindingCard({ finding }: { finding: SafetyFinding }) {
  const { t } = useLocale();
  const { mutate } = useSWRConfig();
  const [status, setStatus] = useState(finding.reviewStatus);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<'saved' | 'error' | null>(null);
  const noteRequired = status === 'resolved' || status === 'dismissed';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (noteRequired && !note.trim()) return;
    setSaving(true);
    setResult(null);
    try {
      await saveMedicationUpdate(`/api/medications/findings/${finding.id}/review`, { status, note: note.trim() });
      await mutate((key) => typeof key === 'string' && key.startsWith('/api/medications'));
      setResult('saved');
      setNote('');
    } catch {
      setResult('error');
    } finally {
      setSaving(false);
    }
  }

  const sourceUrl = finding.knowledgeSource?.url;
  const safeSourceUrl = sourceUrl && /^https:\/\//i.test(sourceUrl) ? sourceUrl : null;
  return (
    <article className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t(`medications.${finding.reviewStatus}`)}</Badge>
        <span className="text-xs text-muted-foreground">{t('medications.certainty')}: {t(`medications.${finding.certainty}`)}</span>
        {finding.severity && <span className="text-xs">{t('medications.severity')}: {finding.severity}</span>}
      </div>
      <h4 className="font-semibold">{finding.title}</h4>
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{finding.explanation}</p>
      {!finding.current && <p className="rounded-md bg-muted p-2 text-xs">{t('medications.stale')}</p>}
      {finding.resolutionNotes && <p dir="auto" className="whitespace-pre-wrap break-words text-sm"><span className="font-medium">{t('medications.note')}: </span>{finding.resolutionNotes}</p>}
      <details>
        <summary className="cursor-pointer text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('medications.source')}</summary>
        <div className="mt-3 space-y-3">
          <EvidenceList evidence={finding.evidence} />
          {finding.knowledgeSource && <div className="space-y-1 text-xs text-muted-foreground">
            <p>{t('medications.provider')}: {safeSourceUrl ? <a className="text-primary underline underline-offset-4" href={safeSourceUrl} target="_blank" rel="noopener noreferrer">{finding.knowledgeSource.provider}</a> : finding.knowledgeSource.provider}</p>
            <p>{t('medications.version')}: {finding.knowledgeSource.version || t('medications.notDocumented')}</p>
            <p>{t('medications.checked')}: {finding.knowledgeSource.checkedAt || t('medications.dateUnknown')}</p>
          </div>}
          <p className="text-xs text-muted-foreground">{t('medications.detected')}: {finding.detectedAt}</p>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('medications.saveReview')}</summary>
        <form onSubmit={submit} className="mt-3 space-y-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">{t('medications.reviewHelp')}</p>
          <MedicationSelect label={t('medications.reviewStatus')} value={status} disabled={saving} onChange={(event) => setStatus(event.target.value as FindingReviewStatus)}>
            {reviewStatuses.map((item) => <option key={item} value={item}>{t(`medications.${item}`)}</option>)}
          </MedicationSelect>
          <label className="block space-y-1.5 text-sm font-medium">
            {t('medications.note')}
            <textarea dir="auto" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} disabled={saving} required={noteRequired} className={`${selectClassName} min-h-20`} />
          </label>
          <Button type="submit" disabled={saving || (noteRequired && !note.trim())}>{t(saving ? 'action.saving' : 'medications.saveReview')}</Button>
          {result && <p role={result === 'error' ? 'alert' : 'status'} className="text-sm">{t(result === 'error' ? 'medications.saveError' : 'medications.saved')}</p>}
        </form>
      </details>
    </article>
  );
}

export function SafetyFindings() {
  const { t } = useLocale();
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [history, setHistory] = useState(false);
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: '20', status, category, history: history ? '1' : '0' });
  const { data, error, isLoading, isValidating, mutate } = useSWR<MedicationFindingsResponse>(`/api/medications/findings?${query}`, medicationFetcher);
  const groups = new Map<FindingCategory, SafetyFinding[]>();
  for (const finding of data?.findings ?? []) groups.set(finding.category, [...(groups.get(finding.category) ?? []), finding]);
  return (
    <section aria-label={t('medications.findings')} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <MedicationSelect label={t('medications.reviewStatus')} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="all">{t('medications.all')}</option>
          {reviewStatuses.map((item) => <option key={item} value={item}>{t(`medications.${item}`)}</option>)}
        </MedicationSelect>
        <MedicationSelect label={t('medications.category')} value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
          <option value="all">{t('medications.all')}</option>
          {(Object.keys(categoryKeys) as FindingCategory[]).map((item) => <option key={item} value={item}>{t(categoryKeys[item])}</option>)}
        </MedicationSelect>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={history} onChange={(event) => { setHistory(event.target.checked); setPage(1); }} />
        {t('medications.includeHistorical')}
      </label>
      {isLoading ? <LoadingMedicationData /> : error || !data ? <MedicationError retry={() => void mutate()} /> : <>
        {data.findings.length === 0 && <p className="rounded-lg border p-6 text-sm text-muted-foreground">{t('medications.noFindings')}</p>}
        {Array.from(groups, ([group, findings]) => <section key={group} className="space-y-3">
          <h3 className="text-base font-semibold">{t(categoryKeys[group])}</h3>
          {findings.map((finding) => <FindingCard key={`${finding.id}-${finding.reviewStatus}`} finding={finding} />)}
        </section>)}
        <Pagination pagination={data.pagination} onPage={setPage} busy={isValidating} />
      </>}
    </section>
  );
}
