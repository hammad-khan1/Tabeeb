"use client";

import { Info } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-provider';
import type { InteractionCoverage } from '@/services/medications/types';

export function ProviderCoverage({ coverage, limitations }: { coverage: InteractionCoverage; limitations: string[] }) {
  const { t } = useLocale();
  const available = coverage.status === 'available';
  const partial = coverage.status === 'partial';
  const details = [...new Set([...coverage.limitations, ...limitations])];
  return (
    <section aria-label={t('medications.provider')} className="rounded-xl border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-sm font-semibold">{t(available ? 'medications.providerAvailable' : partial ? 'medications.providerPartial' : 'medications.providerUnavailable')}</h2>
          {!available && <p className="text-sm text-muted-foreground">{t('medications.providerHelp')}</p>}
          <p className="text-xs text-muted-foreground">{t('medications.provider')}: {coverage.provider} · {t('medications.pairs')}: {coverage.checkedPairs} / {coverage.totalPairs}</p>
          <details>
            <summary className="cursor-pointer text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('medications.limitations')}</summary>
            <div className="mt-2 space-y-2 text-xs text-muted-foreground">
              <p>{t('medications.version')}: {coverage.version || t('medications.notDocumented')}</p>
              <p>{t('medications.checked')}: {coverage.checkedAt || t('medications.dateUnknown')}</p>
              <ul className="list-inside list-disc space-y-1">{details.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
