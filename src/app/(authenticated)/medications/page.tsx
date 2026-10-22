"use client";

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { FileText, Pill, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocale } from '@/components/providers/locale-provider';
import { MEDICATION_STATUSES, type MedicationStatus } from '@/services/medications/types';
import { MedicationRow } from '@/components/medications/medication-details';
import { MedicationTimeline } from '@/components/medications/medication-timeline';
import { SafetyFindings } from '@/components/medications/safety-findings';
import { PrescriptionComparison } from '@/components/medications/prescription-comparison';
import { ProviderCoverage } from '@/components/medications/provider-coverage';
import { PakistanMedicineSearch } from '@/components/medications/pakistan-medicine-search';
import type { MedicationDashboardResponse } from '@/components/medications/api-types';
import { LoadingMedicationData, MedicationError, MedicationSelect, Pagination, medicationFetcher, statusKeys } from '@/components/medications/shared';

export default function MedicationsPage() {
  const { t } = useLocale();
  const [tab, setTab] = useState('overview');
  const [status, setStatus] = useState<MedicationStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [draftSearch, setDraftSearch] = useState('');
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: '25', status, search });
  const { data, error, isLoading, isValidating, mutate } = useSWR<MedicationDashboardResponse>(`/api/medications?${query}`, medicationFetcher);

  function searchMedications(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(draftSearch.trim());
    setPage(1);
  }

  function changeStatus(value: MedicationStatus | 'all') {
    setStatus(value);
    setPage(1);
    setTab('overview');
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Pill className="size-6 shrink-0" aria-hidden />{t('nav.medications')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('medications.subtitle')}</p>
        </div>
        <Button variant="outline" render={<Link href="/briefing" />}><FileText aria-hidden className="size-4" />{t('medications.briefing')}</Button>
      </div>
      <p className="rounded-lg border p-3 text-sm text-muted-foreground">{t('medications.guidance')}</p>
      {isLoading ? <LoadingMedicationData /> : error || !data ? <MedicationError retry={() => void mutate()} /> : <>
        {data.truncated && <p role="status" className="rounded-lg border p-3 text-sm">{t('medications.truncated')}</p>}
        <ProviderCoverage coverage={data.interactionCheck} limitations={data.limitations} />
        <section aria-label={t('medications.overview')} className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {MEDICATION_STATUSES.map((item) => <button key={item} type="button" aria-pressed={status === item} onClick={() => changeStatus(item)} className={`flex flex-col gap-2 rounded-xl border bg-card p-4 text-start transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${status === item ? 'border-primary ring-1 ring-primary' : ''}`}>
            <span className="text-2xl font-semibold tabular-nums">{data.counts[item]}</span>
            <span className="text-xs text-muted-foreground sm:text-sm">{t(statusKeys[item])}</span>
          </button>)}
        </section>
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <div className="overflow-x-auto pb-2">
            <TabsList className="h-auto min-h-9 w-max" aria-label={t('nav.medications')}>
              <TabsTrigger value="overview">{t('medications.overview')}</TabsTrigger>
              <TabsTrigger value="catalog">Pakistan Medicine Catalog</TabsTrigger>
              <TabsTrigger value="findings">{t('medications.findings')}</TabsTrigger>
              <TabsTrigger value="timeline">{t('medications.timeline')}</TabsTrigger>
              <TabsTrigger value="comparison">{t('medications.compare')}</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="overview" className="space-y-4">
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_16rem]">
              <form onSubmit={searchMedications} className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium">
                  {t('medications.search')}
                  <Input type="search" maxLength={200} value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} />
                </label>
                <Button type="submit" variant="outline" size="icon" className="size-9" aria-label={t('medications.search')}><Search aria-hidden /></Button>
              </form>
              <MedicationSelect label={t('medications.filterStatus')} value={status} onChange={(event) => changeStatus(event.target.value as MedicationStatus | 'all')}>
                <option value="all">{t('medications.all')}</option>
                {MEDICATION_STATUSES.map((item) => <option key={item} value={item}>{t(statusKeys[item])}</option>)}
              </MedicationSelect>
            </div>
            {data.medications.length === 0 ? <div className="space-y-3 rounded-xl border bg-card p-8 text-center">
              <Pill className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <p className="text-sm">{t('medications.empty')}</p>
              {Object.values(data.counts).every((count) => count === 0) && <>
                <p className="text-sm text-muted-foreground">{t('medications.emptyHelp')}</p>
                <Button render={<Link href="/documents/upload" />}>{t('action.upload')}</Button>
              </>}
            </div> : <div className="space-y-3">{data.medications.map((medication) => <MedicationRow key={medication.id} medication={medication} resolvedStatus={data.medicationOptions.find((option) => option.id === medication.id)?.status ?? 'unknown'} />)}</div>}
            <Pagination pagination={data.pagination} onPage={setPage} busy={isValidating} />
          </TabsContent>
          <TabsContent value="catalog"><PakistanMedicineSearch /></TabsContent>
          <TabsContent value="findings"><SafetyFindings /></TabsContent>
          <TabsContent value="timeline"><MedicationTimeline medicationOptions={data.medicationOptions} /></TabsContent>
          <TabsContent value="comparison"><PrescriptionComparison documents={data.documents} medicationOptions={data.medicationOptions} /></TabsContent>
        </Tabs>
      </>}
    </div>
  );
}
