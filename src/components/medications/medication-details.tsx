"use client";

import { useState, type FormEvent } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocale } from '@/components/providers/locale-provider';
import { MEDICATION_STATUSES, type MedicationCorrections, type MedicationEvidence, type MedicationRecord, type MedicationStatus } from '@/services/medications/types';
import type { TranslationKey } from '@/lib/i18n';
import type { MedicationDetailsResponse } from './api-types';
import { EvidenceList, LoadingMedicationData, MedicationError, MedicationSelect, medicationFetcher, saveMedicationUpdate, selectClassName, statusKeys } from './shared';

const correctionKeys: Record<keyof MedicationCorrections, TranslationKey> = {
  name: 'medications.name',
  dosage: 'medications.dosage',
  doseAmount: 'medications.doseAmount',
  strength: 'medications.strength',
  route: 'medications.route',
  frequency: 'medications.frequency',
  duration: 'medications.duration',
  instructions: 'medications.instructions',
};

function observationEvidence(medication: MedicationRecord): MedicationEvidence {
  return {
    medicationId: medication.id,
    documentId: medication.documentId,
    documentTitle: medication.documentTitle,
    documentDate: medication.documentDate,
    page: medication.observation.sourcePage ?? null,
    excerpt: medication.observation.excerpt ?? medication.observation.instructions ?? null,
    kind: 'document',
  };
}

function PatientUpdateForm({ medication }: { medication: MedicationRecord }) {
  const { t } = useLocale();
  const { mutate } = useSWRConfig();
  const [status, setStatus] = useState<MedicationStatus | ''>('');
  const [field, setField] = useState<keyof MedicationCorrections | ''>('');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<'saved' | 'error' | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!status && !field) || !note.trim() || (field && !value.trim())) return;
    setSaving(true);
    setResult(null);
    try {
      await saveMedicationUpdate(`/api/medications/${medication.id}/confirmation`, {
        ...(status ? { status } : {}),
        ...(field ? { corrections: { [field]: value.trim() } } : {}),
        note: note.trim(),
      });
      await mutate((key) => typeof key === 'string' && key.startsWith('/api/medications'));
      setResult('saved');
      setNote('');
      setValue('');
      setField('');
      setStatus('');
    } catch {
      setResult('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
      <div>
        <h4 className="font-semibold">{t('medications.confirm')}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{t('medications.correctionsHelp')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <MedicationSelect label={t('medications.filterStatus')} value={status} disabled={saving} onChange={(event) => setStatus(event.target.value as MedicationStatus | '')}>
          <option value="">{t('medications.keepStatus')}</option>
          {MEDICATION_STATUSES.map((item) => <option key={item} value={item}>{t(statusKeys[item])}</option>)}
        </MedicationSelect>
        <MedicationSelect label={t('medications.correctionField')} value={field} disabled={saving} onChange={(event) => { setField(event.target.value as keyof MedicationCorrections | ''); setValue(''); }}>
          <option value="">{t('medications.noCorrection')}</option>
          {(Object.keys(correctionKeys) as Array<keyof MedicationCorrections>).map((key) => <option key={key} value={key}>{t(correctionKeys[key])}</option>)}
        </MedicationSelect>
      </div>
      {field && <label className="block space-y-1.5 text-sm font-medium">{t('medications.correctedValue')}<Input dir="auto" value={value} maxLength={500} disabled={saving} onChange={(event) => setValue(event.target.value)} required /></label>}
      <label className="block space-y-1.5 text-sm font-medium">
        {t('medications.note')}
        <textarea dir="auto" className={`${selectClassName} min-h-20`} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} disabled={saving} required />
        <span className="block text-xs font-normal text-muted-foreground">{t('medications.requiredNote')}</span>
      </label>
      <Button type="submit" disabled={saving || (!status && !field) || !note.trim() || Boolean(field && !value.trim())}>{t(saving ? 'action.saving' : 'action.save')}</Button>
      {result && <p role={result === 'error' ? 'alert' : 'status'} className="text-sm">{t(result === 'error' ? 'medications.saveError' : 'medications.saved')}</p>}
    </form>
  );
}

export function MedicationDetails({ medicationId }: { medicationId: string }) {
  const { t, locale } = useLocale();
  const { data, error, isLoading, mutate } = useSWR<MedicationDetailsResponse>(`/api/medications/${medicationId}`, medicationFetcher);
  if (isLoading) return <LoadingMedicationData />;
  if (error || !data) return <MedicationError retry={() => void mutate()} />;
  const medication = data.medication;
  const observation = medication.observation;
  const identity = observation.normalization;
  const values: Array<[TranslationKey, string | null | undefined]> = [
    ['medications.name', observation.originalName || medication.name],
    ['medications.dosage', medication.dosage],
    ['medications.doseAmount', observation.doseAmount],
    ['medications.strength', observation.strength],
    ['medications.unit', observation.unit],
    ['medications.form', observation.form],
    ['medications.route', medication.route],
    ['medications.frequency', medication.frequency],
    ['medications.duration', medication.duration],
    ['medications.startDate', observation.startDate],
    ['medications.endDate', observation.endDate],
    ['medications.prescriber', observation.prescriber],
    ['medications.instructions', observation.instructions],
  ];
  return (
    <div className="space-y-6 border-t pt-4">
      {!medication.sourceActive && <p className="rounded-lg bg-muted p-3 text-sm">{t('medications.sourceInactive')}</p>}
      <section aria-label={t('medications.original')}>
        <h4 className="mb-3 font-semibold">{t('medications.original')}</h4>
        <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {values.map(([key, value]) => <div key={key}><dt className="text-xs text-muted-foreground">{t(key)}</dt><dd dir="auto" className="mt-1 whitespace-pre-wrap break-words text-sm">{value || t('medications.notDocumented')}</dd></div>)}
        </dl>
      </section>
      <section aria-label={t('medications.normalization')} className="space-y-2">
        <h4 className="font-semibold">{t('medications.normalization')}</h4>
        <Badge variant="outline">{t(`medications.${identity?.status ?? 'unresolved'}`)}</Badge>
        {identity?.normalizedName && <p dir="auto" className="text-sm">{identity.normalizedName}</p>}
        {identity?.rxcui && <p className="text-xs text-muted-foreground">RxNorm · RxCUI {identity.rxcui}{identity.version ? ` · ${identity.version}` : ''}</p>}
        {identity?.ingredients.length ? <ul className="list-inside list-disc text-sm">{identity.ingredients.map((ingredient) => <li key={ingredient.rxcui}><bdi>{ingredient.name}</bdi> · RxCUI {ingredient.rxcui}</li>)}</ul> : null}
        {identity?.limitations.map((limitation) => <p key={limitation} className="text-xs text-muted-foreground">{limitation}</p>)}
      </section>
      <section className="space-y-2" aria-label={t('medications.source')}>
        <h4 className="font-semibold">{t('medications.source')}</h4>
        <EvidenceList evidence={[observationEvidence(medication)]} />
      </section>
      {(medication.patientStatus || Object.keys(medication.corrections).length > 0) && <section className="space-y-2 rounded-lg bg-muted/50 p-4" aria-label={t('medications.patientReported')}>
        <h4 className="font-semibold">{t('medications.patientReported')}</h4>
        {medication.patientStatus && <Badge variant="outline">{t(statusKeys[medication.patientStatus])}</Badge>}
        <dl className="grid gap-3 sm:grid-cols-2">
          {(Object.entries(medication.corrections) as Array<[keyof MedicationCorrections, string | null]>).map(([key, value]) => <div key={key}><dt className="text-xs text-muted-foreground">{t(correctionKeys[key])}</dt><dd dir="auto" className="whitespace-pre-wrap break-words">{value ?? t('medications.notDocumented')}</dd></div>)}
        </dl>
      </section>}
      <PatientUpdateForm medication={medication} />
      <section className="space-y-3" aria-label={t('medications.audit')}>
        <h4 className="font-semibold">{t('medications.audit')}</h4>
        {data.audit.length === 0 ? <p className="text-sm text-muted-foreground">{t('medications.auditEmpty')}</p> : <ol className="space-y-3">
          {data.audit.map((entry) => <li key={entry.id} className="border-s-2 ps-3 text-sm">
            <time dateTime={entry.createdAt} className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString(locale)}</time>
            <p className="mt-1 font-medium">{t('medications.patientReported')}</p>
            {entry.note && <p dir="auto" className="mt-1 whitespace-pre-wrap break-words">{entry.note}</p>}
          </li>)}
        </ol>}
      </section>
    </div>
  );
}

export function MedicationRow({ medication }: { medication: MedicationRecord }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const status = medication.patientStatus ?? medication.observation.status ?? 'prescribed_unconfirmed';
  return (
    <details className="rounded-xl border bg-card p-4" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="inline-flex max-w-full flex-wrap items-center gap-2 align-middle">
          <span dir="auto" className="break-words font-semibold">{medication.name}</span>
          <Badge variant="outline">{t(statusKeys[status])}</Badge>
        </span>
        <span className="mt-2 block text-sm text-muted-foreground"><bdi>{[medication.observation.strength || medication.dosage, medication.frequency, medication.route].filter(Boolean).join(' · ') || t('medications.notDocumented')}</bdi></span>
        <span className="mt-1 block text-xs text-muted-foreground">{medication.documentTitle || t('medications.document')} · {medication.documentDate || t('medications.dateUnknown')}</span>
        <span className="mt-2 block text-xs text-primary">{t('medications.details')}</span>
      </summary>
      {expanded && <div className="pt-4"><MedicationDetails medicationId={medication.id} /></div>}
    </details>
  );
}
