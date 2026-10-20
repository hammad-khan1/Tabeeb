"use client";

import { useState } from 'react';
import useSWR from 'swr';
import { Badge } from '@/components/ui/badge';
import { useLocale } from '@/components/providers/locale-provider';
import type { MedicationDashboardResponse, MedicationTimelineResponse } from './api-types';
import { EvidenceList, LoadingMedicationData, MedicationError, MedicationSelect, Pagination, medicationFetcher } from './shared';

export function MedicationTimeline({ medicationOptions }: Pick<MedicationDashboardResponse, 'medicationOptions'>) {
  const { t } = useLocale();
  const [medicationId, setMedicationId] = useState('');
  const [view, setView] = useState('all');
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: '25', view });
  if (medicationId) query.set('medicationId', medicationId);
  const { data, error, isLoading, isValidating, mutate } = useSWR<MedicationTimelineResponse>(`/api/medications/timeline?${query}`, medicationFetcher);
  return (
    <section aria-label={t('medications.timeline')} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <MedicationSelect label={t('medications.filterMedication')} value={medicationId} onChange={(event) => { setMedicationId(event.target.value); setPage(1); }}>
          <option value="">{t('medications.all')}</option>
          {medicationOptions.map((medication) => <option key={medication.id} value={medication.id}>{medication.name} · {t(`medications.${medication.status}`)}</option>)}
        </MedicationSelect>
        <MedicationSelect label={t('medications.timelineView')} value={view} onChange={(event) => { setView(event.target.value); setPage(1); }}>
          <option value="all">{t('medications.all')}</option>
          <option value="current">{t('medications.current')}</option>
          <option value="historical">{t('medications.historicalView')}</option>
        </MedicationSelect>
      </div>
      {isLoading ? <LoadingMedicationData /> : error || !data ? <MedicationError retry={() => void mutate()} /> : <>
        {data.events.length === 0 ? <p className="rounded-lg border p-6 text-sm text-muted-foreground">{t('medications.noEvents')}</p> : <ol className="ms-2 space-y-5 border-s-2 py-2 ps-5">
          {data.events.map((event) => <li key={event.id} className="relative space-y-2">
            <span className="absolute -start-[1.7rem] top-1.5 size-3 rounded-full border-2 border-background bg-muted-foreground" aria-hidden />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{event.date || t('medications.dateUnknown')}</span>
              <Badge variant="outline">{t(`medications.${event.confirmation}`)}</Badge>
            </div>
            <h3 className="font-semibold">{event.title}</h3>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{event.description}</p>
            <details className="rounded-lg border bg-card p-3">
              <summary className="cursor-pointer text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('medications.source')}</summary>
              <div className="mt-3"><EvidenceList evidence={event.evidence} /></div>
            </details>
          </li>)}
        </ol>}
        <Pagination pagination={data.pagination} onPage={setPage} busy={isValidating} />
      </>}
    </section>
  );
}
