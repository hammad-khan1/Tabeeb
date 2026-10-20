"use client";

import { useState, type FormEvent } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/providers/locale-provider';
import type { PrescriptionComparison as Comparison } from '@/services/medications/types';
import type { MedicationDashboardResponse } from './api-types';
import { EvidenceList, LoadingMedicationData, MedicationError, MedicationSelect, medicationFetcher } from './shared';

export function PrescriptionComparison({ documents, medicationOptions }: Pick<MedicationDashboardResponse, 'documents' | 'medicationOptions'>) {
  const { t } = useLocale();
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useSWR<Comparison>(query, medicationFetcher);
  const names = new Map(medicationOptions.map((medication) => [medication.id, medication.name]));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (left && right && left !== right) setQuery(`/api/medications/compare?${new URLSearchParams({ left, right })}`);
  }

  return (
    <section aria-label={t('medications.compare')} className="space-y-4">
      <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">{t('medications.compareHelp')}</p>
      {documents.length < 2 ? <p className="text-sm">{t('medications.notEnoughDocuments')}</p> : <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <MedicationSelect label={t('medications.firstPrescription')} value={left} onChange={(event) => { setLeft(event.target.value); setQuery(null); }} required>
            <option value="">{t('medications.chooseDocument')}</option>
            {documents.map((document) => <option key={document.id} value={document.id} disabled={document.id === right}>{document.title} · {document.documentDate || t('medications.dateUnknown')}</option>)}
          </MedicationSelect>
          <MedicationSelect label={t('medications.secondPrescription')} value={right} onChange={(event) => { setRight(event.target.value); setQuery(null); }} required>
            <option value="">{t('medications.chooseDocument')}</option>
            {documents.map((document) => <option key={document.id} value={document.id} disabled={document.id === left}>{document.title} · {document.documentDate || t('medications.dateUnknown')}</option>)}
          </MedicationSelect>
        </div>
        <Button type="submit" disabled={!left || !right || left === right || isLoading}>{t('medications.compareAction')}</Button>
      </form>}
      {isLoading && <LoadingMedicationData />}
      {error && <MedicationError retry={() => void mutate()} />}
      {data && query && !isLoading && !error && <div aria-live="polite" className="space-y-4">
        {data.differences.length === 0 && <p className="text-sm text-muted-foreground">{t('medications.noDifferences')}</p>}
        {data.differences.map((difference) => <article key={difference.id} className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-semibold">{difference.medicationIds.map((id) => names.get(id) || id).join(' / ')} · {t(`medications.${difference.field}`)}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{t('medications.firstPrescription')}</p><p dir="auto" className="mt-1 whitespace-pre-wrap break-words text-sm">{difference.before || t('medications.notDocumented')}</p></div>
            <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{t('medications.secondPrescription')}</p><p dir="auto" className="mt-1 whitespace-pre-wrap break-words text-sm">{difference.after || t('medications.notDocumented')}</p></div>
          </div>
          <p className="text-sm text-muted-foreground">{difference.explanation}</p>
          <EvidenceList evidence={difference.evidence} />
        </article>)}
        <div className="grid gap-4 sm:grid-cols-2">
          {([['medications.onlyFirst', data.onlyInFirst], ['medications.onlySecond', data.onlyInSecond]] as const).map(([key, ids]) => <section key={key} className="space-y-2 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">{t(key)}</h3>
            {ids.length === 0 ? <p className="text-sm text-muted-foreground">{t('medications.none')}</p> : <ul className="list-inside list-disc text-sm">{ids.map((id) => <li key={id}><bdi>{names.get(id) || id}</bdi></li>)}</ul>}
          </section>)}
        </div>
        {data.limitations.length > 0 && <div className="space-y-2 rounded-lg bg-muted/50 p-4">
          <h3 className="text-sm font-semibold">{t('medications.limitations')}</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">{data.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        </div>}
      </div>}
    </section>
  );
}
