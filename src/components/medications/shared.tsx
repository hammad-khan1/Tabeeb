"use client";

import type { ComponentProps } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/providers/locale-provider';
import type { MedicationEvidence, MedicationStatus } from '@/services/medications/types';
import type { TranslationKey } from '@/lib/i18n';
import type { MedicationPagination } from './api-types';

export const selectClassName = 'min-h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export const statusKeys: Record<MedicationStatus, TranslationKey> = {
  confirmed_current: 'medications.confirmed_current',
  prescribed_unconfirmed: 'medications.prescribed_unconfirmed',
  historical: 'medications.historical',
  discontinued: 'medications.discontinued',
  changed: 'medications.changed',
  unknown: 'medications.unknown',
};

export async function medicationFetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('Medication request failed');
  return response.json() as Promise<T>;
}

export async function saveMedicationUpdate(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Medication update failed');
}

export function MedicationSelect({ label, children, ...props }: ComponentProps<'select'> & { label: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
      {label}
      <select className={selectClassName} {...props}>{children}</select>
    </label>
  );
}

export function LoadingMedicationData() {
  const { t } = useLocale();
  return <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 aria-hidden className="size-4 animate-spin" />{t('status.loading')}</p>;
}

export function MedicationError({ retry }: { retry?: () => void }) {
  const { t } = useLocale();
  return (
    <div role="alert" className="space-y-3 rounded-lg border p-4">
      <p className="text-sm">{t('medications.loadError')}</p>
      {retry && <Button variant="outline" onClick={retry}>{t('action.retry')}</Button>}
    </div>
  );
}

export function Pagination({ pagination, onPage, busy = false }: {
  pagination: MedicationPagination;
  onPage: (page: number) => void;
  busy?: boolean;
}) {
  const { t } = useLocale();
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t('medications.page')} {pagination.page} {t('medications.of')} {totalPages} · {pagination.total} {t('medications.records')}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy || pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>{t('medications.previous')}</Button>
        <Button variant="outline" disabled={busy || !pagination.hasMore} onClick={() => onPage(pagination.page + 1)}>{t('medications.next')}</Button>
      </div>
    </div>
  );
}

/** Only supported document IDs and positive page numbers can form a source URL. */
export function sourceDocumentUrl(documentId: string | null, page: number | null): string | null {
  if (!documentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)) return null;
  const suffix = page && Number.isInteger(page) && page > 0 ? `#page=${page}` : '';
  return `/api/documents/${documentId}/file${suffix}`;
}

export function EvidenceList({ evidence }: { evidence: MedicationEvidence[] }) {
  const { t } = useLocale();
  return (
    <ul className="space-y-3">
      {evidence.map((source, index) => {
        const href = sourceDocumentUrl(source.documentId, source.page);
        const label = source.kind === 'patient' ? t('medications.patientReported')
          : source.kind === 'allergy_record' ? t('medications.allergyRecord')
            : source.documentTitle || t('medications.document');
        return (
          <li key={`${source.documentId}-${source.medicationId}-${index}`} className="min-w-0 rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">{source.documentDate || t('medications.dateUnknown')}</span>
              {source.page && <span className="text-xs text-muted-foreground">{t('medications.page')} {source.page}</span>}
            </div>
            {source.excerpt && <blockquote dir="auto" className="mt-2 whitespace-pre-wrap break-words border-s-2 ps-3 text-muted-foreground">{source.excerpt}</blockquote>}
            {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-primary underline underline-offset-4">{t('medications.openSource')}<ExternalLink aria-hidden className="size-3" /></a>
              : <p className="mt-2 text-xs text-muted-foreground">{t('medications.noDocument')}</p>}
          </li>
        );
      })}
    </ul>
  );
}
