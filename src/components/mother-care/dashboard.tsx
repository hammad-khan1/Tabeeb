"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Pill,
  Syringe,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/components/providers/locale-provider";
import { fetcher, postJson, request } from "@/lib/http-client";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { IRON_FOLIC_GUIDANCE, TT_GUIDANCE } from "@/services/pregnancy/supplements";
import { DangerSigns } from "./danger-signs";
import { FamilyAndPlan } from "./family-and-plan";
import { displayDate, pakistanToday, type DocumentSummary, type PregnancyView } from "./types";

const STATUS_ICON = {
  done: CheckCircle2,
  due: Clock,
  upcoming: Circle,
  missed: XCircle,
} as const;

/** Fixed three-language content, shown in the interface language. */
function useText() {
  const { locale } = useLocale();
  return (text: { en: string; ur: string }) => (locale === "ur" ? text.ur : text.en);
}

export function Dashboard({ pregnancyId, onDeleted }: { pregnancyId: string; onDeleted: () => void }) {
  const { t } = useLocale();
  const pick = useText();
  const { data: view, error, mutate } = useSWR<PregnancyView>(`/api/pregnancy/${pregnancyId}`, fetcher);
  const { data: docs } = useSWR<{ documents: DocumentSummary[] }>("/api/documents?limit=100", fetcher, {
    revalidateOnFocus: false,
  });
  const [dangerOpen, setDangerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [message, setMessage] = useState("");

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-destructive" role="alert">
          {error instanceof Error ? error.message : t("error.title")}
        </CardContent>
      </Card>
    );
  }
  if (!view) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label={t("status.loading")} />
      </div>
    );
  }

  const base = `/api/pregnancy/${pregnancyId}`;
  const today = pakistanToday();

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setMessage("");
    try {
      await action();
      await mutate();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("error.title"));
    } finally {
      setBusy(null);
    }
  };

  const { pregnancy, gestationalAge: age } = view;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold">{pregnancy.motherName}</p>
              {view.phase === "antenatal" && (
                <p className="text-lg">
                  <span className="text-3xl font-semibold tabular-nums">{age.weeks}</span> {t("mother.weeksDays")}{" "}
                  <span className="tabular-nums">{age.days}</span> {t("mother.days")}
                </p>
              )}
              {view.phase === "postnatal" && <p className="text-lg">{t("mother.postnatal")}</p>}
              {view.phase === "ended" && <p className="text-lg">{t("mother.ended")}</p>}
            </div>
            {view.phase === "antenatal" && (
              <dl className="text-end">
                <dt className="text-sm text-muted-foreground">{t("mother.dueDate")}</dt>
                <dd className="text-lg font-medium">{displayDate(pregnancy.dueDate)}</dd>
                <dd className="text-sm text-muted-foreground tabular-nums">
                  {Math.max(0, view.daysToDue)} {t("mother.daysLeft")}
                </dd>
              </dl>
            )}
          </div>

          {view.phase !== "ended" && (
            <Button
              size="lg"
              className="h-16 w-full bg-red-700 text-lg font-semibold text-white hover:bg-red-800"
              onClick={() => setDangerOpen(true)}
            >
              <TriangleAlert className="size-6" aria-hidden="true" />
              {t("mother.danger.button")}
              <span className="font-urdu ms-2 text-xl" lang="ur">خطرے کی علامات</span>
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t("mother.noDiagnosis")}</p>
        </CardContent>
      </Card>

      {view.reminder && (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <Bell className="mt-1 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-urdu text-lg leading-loose" lang="ur" dir="rtl">{view.reminder.ur}</p>
            <p>{view.reminder.roman}</p>
          </div>
        </div>
      )}

      {message && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {message}
        </p>
      )}

      {view.phase === "antenatal" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CalendarCheck className="size-5" aria-hidden="true" />
              {t("mother.visits.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {view.schedule.map((contact) => {
                const Icon = STATUS_ICON[contact.status];
                const isNext = view.nextContact?.number === contact.number;
                return (
                  <li
                    key={contact.number}
                    className={cn(
                      "rounded-lg border p-3",
                      isNext ? "border-primary border-2" : "border-border",
                      contact.status === "missed" && "border-destructive/50"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Icon
                        className={cn(
                          "size-5 shrink-0",
                          contact.status === "done" && "text-emerald-600",
                          contact.status === "missed" && "text-destructive"
                        )}
                        aria-hidden="true"
                      />
                      <span className="font-medium">
                        {t("mother.week")} {contact.week}
                      </span>
                      <span className="text-sm text-muted-foreground">{displayDate(contact.date)}</span>
                      <span className="ms-auto rounded bg-muted px-2 py-0.5 text-xs">
                        {t(`mother.visits.status.${contact.status}` as TranslationKey)}
                        {isNext && ` · ${t("mother.visits.next")}`}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{pick(contact.purpose)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {contact.status === "done" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => run(`c${contact.number}`, () => postJson(`${base}/contacts`, { contactNumber: contact.number, doneOn: null }, "PATCH"))}
                          disabled={busy !== null}
                        >
                          {t("mother.visits.undo")}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          className="h-10"
                          onClick={() => run(`c${contact.number}`, () => postJson(`${base}/contacts`, { contactNumber: contact.number, doneOn: today }, "PATCH"))}
                          disabled={busy !== null}
                        >
                          {busy === `c${contact.number}` && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                          {t("mother.visits.markDone")}
                        </Button>
                      )}
                      <select
                        aria-label={`${t("mother.visits.notes")}, ${t("mother.week")} ${contact.week}`}
                        value={contact.documentId ?? ""}
                        onChange={(event) =>
                          run(`n${contact.number}`, () =>
                            postJson(`${base}/contacts`, { contactNumber: contact.number, documentId: event.target.value || null }, "PATCH")
                          )
                        }
                        className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">{t("mother.visits.noNotes")}</option>
                        {(docs?.documents ?? []).map((doc) => (
                          <option key={doc.id} value={doc.id}>{doc.title}</option>
                        ))}
                      </select>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {view.phase === "antenatal" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Pill className="size-5" aria-hidden="true" />
                {t("mother.iron.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-base">{t("mother.iron.question")}</p>
              {view.iron.takenToday ? (
                <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-5" aria-hidden="true" />
                  {t("mother.iron.taken")}
                </p>
              ) : (
                <Button
                  size="lg"
                  className="h-14 w-full text-base"
                  onClick={() => run("iron", () => postJson(`${base}/supplements`, { kind: "iron_folic", day: today }))}
                  disabled={busy !== null}
                >
                  {busy === "iron" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                  {t("mother.iron.yes")}
                </Button>
              )}
              <p className="text-sm">
                <span className="text-2xl font-semibold tabular-nums">{view.iron.streak}</span> {t("mother.iron.streak")} ·{" "}
                <span className="tabular-nums">{view.iron.totalDays}</span> {t("mother.iron.total")}
              </p>
              <p className="text-xs text-muted-foreground">{pick(IRON_FOLIC_GUIDANCE)}</p>
            </CardContent>
          </Card>
        )}

        {view.phase === "antenatal" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Syringe className="size-5" aria-hidden="true" />
                {t("mother.tt.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {view.tetanus.length === 0 ? (
                <p>{t("mother.tt.complete")}</p>
              ) : (
                <ul className="space-y-2">
                  {view.tetanus.map((dose) => (
                    <li key={dose.number} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                      <span>
                        {t("mother.tt.dose")} {dose.number}:{" "}
                        <strong>
                          {dose.status === "given"
                            ? `${t("mother.tt.given")} ${displayDate(dose.givenOn)}`
                            : dose.status === "due"
                              ? t("mother.tt.due")
                              : `${t("mother.tt.later")}${dose.earliest ? ` (${t("mother.tt.from")} ${displayDate(dose.earliest)})` : ""}`}
                        </strong>
                      </span>
                      {dose.status === "due" && (
                        <Button
                          variant="outline"
                          className="h-10"
                          onClick={() => run("tt", () => postJson(`${base}/supplements`, { kind: "tt_dose", day: today }))}
                          disabled={busy !== null}
                        >
                          {t("mother.tt.record")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">{pick(TT_GUIDANCE)}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("mother.hb.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {view.hb.readings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("mother.hb.none")}</p>
            ) : (
              <ul className="space-y-1 tabular-nums">
                {view.hb.readings.map((reading, index) => (
                  <li key={index} className="flex justify-between">
                    <span dir="ltr">
                      {reading.value} {reading.unit}
                    </span>
                    <span className="text-sm text-muted-foreground">{displayDate(reading.testDate)}</span>
                  </li>
                ))}
              </ul>
            )}
            {view.hb.falling && (
              <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {t("mother.hb.falling")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("mother.bp.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="bp-top">{t("mother.bp.top")}</Label>
                <Input id="bp-top" inputMode="numeric" value={systolic} onChange={(e) => setSystolic(e.target.value)} className="h-11" dir="ltr" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bp-bottom">{t("mother.bp.bottom")}</Label>
                <Input id="bp-bottom" inputMode="numeric" value={diastolic} onChange={(e) => setDiastolic(e.target.value)} className="h-11" dir="ltr" />
              </div>
              <Button
                className="h-11"
                disabled={!systolic || !diastolic || busy !== null}
                onClick={() =>
                  run("bp", async () => {
                    await postJson(`${base}/bp`, { systolic: Number(systolic), diastolic: Number(diastolic) });
                    setSystolic("");
                    setDiastolic("");
                  })
                }
              >
                {t("mother.bp.save")}
              </Button>
            </div>
            <ul className="space-y-1 text-sm tabular-nums">
              {view.bp.map((reading, index) => (
                <li key={index} className="flex justify-between">
                  <span dir="ltr">
                    {reading.systolic}/{reading.diastolic}
                  </span>
                  <span className="text-muted-foreground">{displayDate(reading.measuredAt)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <FamilyAndPlan
        view={view}
        documents={docs?.documents ?? []}
        run={run}
        busy={busy}
        onDeleted={async () => {
          await request(base, { method: "DELETE" });
          onDeleted();
        }}
      />

      {dangerOpen && <DangerSigns view={view} onClose={() => setDangerOpen(false)} />}
    </div>
  );
}
