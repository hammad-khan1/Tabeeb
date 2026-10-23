"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2, Clock, Copy, Loader2, Share2, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/components/providers/locale-provider";
import { riskLabel, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { fetcher, postJson, type RiskResponse } from "./api";

/** Icon and wording carry the band as well as colour, so colour is never the only signal. */
const BAND_STYLE = {
  low: { icon: CheckCircle2, className: "border-emerald-600/40 bg-emerald-600/10" },
  moderate: { icon: AlertTriangle, className: "border-amber-500/50 bg-amber-500/10" },
  high: { icon: ShieldAlert, className: "border-destructive/50 bg-destructive/10" },
} as const;

export function RiskSummary({ onAnswer }: { onAnswer: (mode: "pending" | "all") => void }) {
  const { t, locale } = useLocale();
  const { data } = useSWR<RiskResponse>("/api/ramadan/risk", fetcher, { revalidateOnFocus: false });

  const [sharing, setSharing] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  if (!data) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label={t("status.loading")} />
        </CardContent>
      </Card>
    );
  }

  const share = async () => {
    setSharing(true);
    setError("");
    try {
      const { url } = await postJson<{ url: string }>("/api/ramadan/plan/share", {});
      setLink(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the link.");
    } finally {
      setSharing(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  };

  const { result } = data;
  const itemLabel = (id: string) => {
    const item = data.riskItems.find((candidate) => candidate.id === id);
    return item ? riskLabel(locale, item.label, item.id) : id;
  };
  const optionLabel = (id: string, option: string) => {
    const item = data.riskItems.find((candidate) => candidate.id === id);
    const found = item?.options.find((candidate) => candidate.id === option);
    return found && item ? riskLabel(locale, found.label, item.id, found.id) : option;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("ramadan.result.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {result.status === "complete" ? (
          (() => {
            const style = BAND_STYLE[result.band];
            const Icon = style.icon;
            return (
              <div className={cn("rounded-lg border-2 p-4", style.className)} role="status">
                <p className="flex items-center gap-2 text-2xl font-semibold">
                  <Icon className="size-6" aria-hidden="true" />
                  {t(`ramadan.result.${result.band}` as TranslationKey)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("ramadan.result.score")}: {result.total}
                </p>
                <p className="mt-3 text-base">{t(`ramadan.result.${result.band}Advice` as TranslationKey)}</p>
              </div>
            );
          })()
        ) : (
          <div className="rounded-lg border-2 border-dashed border-border p-4" role="status">
            <p className="flex items-center gap-2 text-xl font-semibold">
              <Clock className="size-5" aria-hidden="true" />
              {t("ramadan.result.incomplete")}
            </p>
            {result.missing.length > 0 && <p className="mt-2 text-sm">{t("ramadan.result.missing")}</p>}
            {result.unverified.length > 0 && (
              <p className="mt-2 text-sm text-muted-foreground">{t("ramadan.result.unverified")}</p>
            )}
          </div>
        )}

        <p className="text-sm text-muted-foreground">{t("ramadan.guidance")}</p>

        {data.items.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {data.items.map((entry) => (
              <li key={entry.item} className="space-y-0.5 px-3 py-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{itemLabel(entry.item)}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {entry.points === null
                      ? t("ramadan.result.pointsPending")
                      : `${entry.points} ${t("ramadan.result.points")}`}
                  </span>
                </div>
                <p>{optionLabel(entry.item, entry.option)}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`ramadan.result.source.${entry.source}` as TranslationKey)}
                  {entry.provenance &&
                    ` · ${entry.provenance.value}${entry.provenance.date ? ` (${entry.provenance.date})` : ""}`}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          {data.pending.length > 0 && (
            <Button size="lg" className="h-12" onClick={() => onAnswer("pending")}>
              {t("ramadan.result.continue")}
            </Button>
          )}
          <Button size="lg" variant="outline" className="h-12" onClick={() => onAnswer("all")}>
            {t("ramadan.result.edit")}
          </Button>
          <Button size="lg" variant="secondary" className="h-12" onClick={share} disabled={sharing}>
            {sharing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Share2 className="size-4" aria-hidden="true" />
            )}
            {t("ramadan.share.button")}
          </Button>
        </div>

        {link && (
          <div className="space-y-2" aria-live="polite">
            <p className="text-sm">{t("ramadan.share.ready")}</p>
            <div className="flex gap-2">
              <Input readOnly value={link} aria-label={t("ramadan.share.button")} className="h-11" dir="ltr" />
              <Button variant="outline" className="h-11" onClick={copy}>
                <Copy className="size-4" aria-hidden="true" />
                {copied ? t("ramadan.share.copied") : t("ramadan.share.copy")}
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
