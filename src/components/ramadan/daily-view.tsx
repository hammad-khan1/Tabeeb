"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Bell, BellOff, Droplet, Info, Loader2, Pill, Sunrise, Sunset } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/components/providers/locale-provider";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { clock, fetcher, postJson, type Reminder, type TodayResponse } from "./api";
import { LogSugarDialog } from "./log-sugar-dialog";
import type { ActiveAlert } from "./break-fast-alert";

interface DocumentSummary {
  id: string;
  title: string;
  documentDate: string | null;
}

function countdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function DailyView({ onAlert }: { onAlert: (alert: ActiveAlert) => void }) {
  const { t } = useLocale();
  const now = useNow();
  const { data, error, mutate } = useSWR<TodayResponse>("/api/ramadan/today", fetcher, {
    refreshInterval: 5 * 60_000,
  });
  const { data: documents } = useSWR<{ documents: DocumentSummary[] }>(
    "/api/documents?type=prescription&limit=50",
    fetcher,
    { revalidateOnFocus: false }
  );
  const [logOpen, setLogOpen] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive" role="alert">
          {error instanceof Error ? error.message : t("error.title")}
        </CardContent>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label={t("status.loading")} />
        </CardContent>
      </Card>
    );
  }

  const sehri = new Date(data.sehriEnds).getTime();
  const iftar = new Date(data.iftar).getTime();
  const [target, untilKey] =
    now < sehri
      ? [sehri, "ramadan.today.untilSehri" as const]
      : now < iftar
        ? [iftar, "ramadan.today.untilIftar" as const]
        : [new Date(data.tomorrowSehriEnds).getTime(), "ramadan.today.untilSehri" as const];

  const nextMedicine = data.reminders.find(
    (reminder) => reminder.kind === "medicine" && reminder.active && new Date(reminder.at).getTime() > now
  );

  const prescriptions = documents?.documents ?? [];

  const keyOf = (reminder: Reminder) => `${reminder.kind}:${reminder.slot}:${reminder.medicationId ?? ""}`;

  const toggle = async (reminder: Reminder) => {
    setToggling(keyOf(reminder));
    try {
      await postJson(
        "/api/ramadan/reminders",
        {
          kind: reminder.kind,
          slot: reminder.slot,
          medicationId: reminder.medicationId ?? null,
          label: reminder.label,
          active: !reminder.active,
        },
        "PATCH"
      );
      await mutate();
    } finally {
      setToggling(null);
    }
  };

  const linkPrescription = async (documentId: string) => {
    setLinking(true);
    try {
      await postJson("/api/ramadan/plan", { doctorPlanDocumentId: documentId || null }, "PATCH");
      await mutate();
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            {t("ramadan.today.title")}
            {data.city && <span className="ms-2 text-base font-normal text-muted-foreground">{data.city}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!data.inRamadan && (
            <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t("ramadan.today.preview")}
            </p>
          )}

          <div className="text-center" aria-live="off">
            <p className="text-5xl font-semibold tabular-nums" dir="ltr">
              {countdown(target - now)}
            </p>
            <p className="text-muted-foreground">{t(untilKey)}</p>
          </div>

          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3">
              <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Sunrise className="size-4" aria-hidden="true" />
                {t("ramadan.today.sehriEnds")}
              </dt>
              <dd className="text-2xl font-semibold tabular-nums" dir="ltr">
                {clock(data.sehriEnds)}
              </dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Sunset className="size-4" aria-hidden="true" />
                {t("ramadan.today.iftar")}
              </dt>
              <dd className="text-2xl font-semibold tabular-nums" dir="ltr">
                {clock(data.iftar)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">{t("ramadan.today.timetableNote")}</p>

          <Button size="lg" className="h-16 w-full text-lg" onClick={() => setLogOpen(true)}>
            <Droplet className="size-5" aria-hidden="true" />
            {t("ramadan.log.button")}
          </Button>

          {nextMedicine && (
            <p className="flex items-center gap-2 text-base">
              <Pill className="size-5" aria-hidden="true" />
              <span className="font-medium">{t("ramadan.today.nextMedicine")}:</span>
              {nextMedicine.label} · <span dir="ltr">{clock(nextMedicine.at)}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("ramadan.today.reminders")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {data.reminders.map((reminder) => {
              const key = keyOf(reminder);
              const label =
                reminder.kind === "medicine" ? reminder.label : t(`ramadan.kind.${reminder.kind}` as TranslationKey);
              return (
                <li key={key} className={cn("flex items-center gap-3 py-2.5", !reminder.active && "opacity-60")}>
                  <span className="w-14 shrink-0 font-medium tabular-nums" dir="ltr">
                    {clock(reminder.at)}
                  </span>
                  <span className="flex-1">
                    {label}
                    <span className="block text-xs text-muted-foreground">
                      {t(`ramadan.slot.${reminder.slot}` as TranslationKey)}
                      {!reminder.active && ` · ${t("ramadan.today.reminderIsOff")}`}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    aria-label={`${label}: ${t(reminder.active ? "ramadan.today.reminderOn" : "ramadan.today.reminderOff")}`}
                    aria-pressed={reminder.active}
                    onClick={() => toggle(reminder)}
                    disabled={toggling === key}
                  >
                    {reminder.active ? <Bell className="size-5" aria-hidden="true" /> : <BellOff className="size-5" aria-hidden="true" />}
                  </Button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {(data.askDoctor || data.doctorPlanDocumentId) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Pill className="size-5" aria-hidden="true" />
              {data.askDoctor ? t("ramadan.today.askDoctor") : t("ramadan.today.prescription")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.askDoctor && <p className="text-sm text-muted-foreground">{t("ramadan.today.askDoctorHelp")}</p>}
            {data.unscheduled.length > 0 && (
              <ul className="space-y-2">
                {data.unscheduled.map((medicine) => (
                  <li key={medicine.medicationId} className="rounded-md border border-border px-3 py-2">
                    <p className="font-medium" dir="ltr">
                      {medicine.name}
                      {medicine.frequency && <span className="font-normal text-muted-foreground"> · {medicine.frequency}</span>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t(`ramadan.today.unscheduled.${medicine.reason}` as TranslationKey)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <Label htmlFor="doctor-prescription">{t("ramadan.today.prescription")}</Label>
              <p className="text-sm text-muted-foreground">{t("ramadan.today.prescriptionHelp")}</p>
              <select
                id="doctor-prescription"
                value={data.doctorPlanDocumentId ?? ""}
                onChange={(event) => linkPrescription(event.target.value)}
                disabled={linking}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              >
                <option value="">{t("ramadan.today.prescriptionNone")}</option>
                {prescriptions.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.title}
                    {document.documentDate ? ` (${document.documentDate.slice(0, 10)})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("ramadan.today.readings")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.readings.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("ramadan.today.noReadings")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.readings.map((reading) => (
                <li key={reading.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="tabular-nums" dir="ltr">
                    {reading.valueMgDl === null ? "—" : `${Math.round(reading.valueMgDl)} mg/dL`}
                  </span>
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-xs",
                      reading.alertLevel === "none" ? "bg-muted" : "bg-destructive/15 text-destructive"
                    )}
                  >
                    {t(`ramadan.alertLevel.${reading.alertLevel}` as TranslationKey)}
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums" dir="ltr">
                    {clock(reading.loggedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <LogSugarDialog open={logOpen} onOpenChange={setLogOpen} onLogged={() => mutate()} onAlert={onAlert} />
    </div>
  );
}
