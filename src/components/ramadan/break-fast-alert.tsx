"use client";

import { useEffect, useRef, useState } from "react";
import { AlertOctagon, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { postJson, type AlertMessage, type GlucoseResponse } from "./api";

export interface ActiveAlert {
  message: AlertMessage;
  /** null when the reading is still waiting for the patient's confirmation. */
  logId: string | null;
  caregiverNotified: boolean;
  /** The unconfirmed reading, stored when the patient presses "Done". */
  unconfirmed?: {
    value: number;
    unit: "mg_dl" | "mmol_l";
    symptoms: string[];
    source: "typed" | "voice" | "photo";
  };
}

/**
 * Full screen, Urdu first, English below. Red, but never only red: the heading, the
 * icon and the words all say "break your fast", so it reads the same without colour.
 */
export function BreakFastAlert({ alert, onClose }: { alert: ActiveAlert; onClose: () => void }) {
  const { t } = useLocale();
  const doneRef = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    doneRef.current?.focus();
  }, []);

  const done = async () => {
    setSaving(true);
    setError("");
    try {
      let logId = alert.logId;
      if (!logId && alert.unconfirmed) {
        // Pressing "Done" on a reading still awaiting confirmation confirms it.
        const outcome = await postJson<GlucoseResponse>("/api/ramadan/glucose", {
          ...alert.unconfirmed,
          confirmed: true,
        });
        if (outcome.status === "logged") logId = outcome.log.id;
      }
      if (logId) {
        await postJson(`/api/ramadan/glucose/${logId}`, { fastBroken: true }, "PATCH");
      }
      setRecorded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record this.");
    } finally {
      setSaving(false);
    }
  };

  const { action, permitted } = alert.message;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="break-fast-title"
      aria-describedby="break-fast-action"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-red-700 text-white"
    >
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-10">
        <h2 id="break-fast-title" className="flex items-center gap-3 text-2xl font-bold">
          <AlertOctagon className="size-10 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-urdu block text-3xl leading-loose" lang="ur" dir="rtl">
              ابھی روزہ کھول دیں
            </span>
            <span className="block">{t("ramadan.alert.title")}</span>
          </span>
        </h2>

        <div id="break-fast-action" className="space-y-3">
          <p className="font-urdu text-3xl leading-loose" lang="ur" dir="rtl">
            {action.ur}
          </p>
          <p className="text-xl font-semibold">{action.roman}</p>
          <p className="text-lg">{action.en}</p>
        </div>

        <div className="space-y-1 rounded-lg bg-white/10 p-4">
          <p className="font-urdu text-xl leading-loose" lang="ur" dir="rtl">
            {permitted.ur}
          </p>
          <p>{permitted.roman}</p>
          <p className="text-sm">{permitted.en}</p>
        </div>

        {alert.caregiverNotified && <p className="text-sm">{t("ramadan.alert.caregiverNotified")}</p>}

        <div aria-live="assertive">
          {recorded ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-lg">
                <CheckCircle2 className="size-6" aria-hidden="true" />
                {t("ramadan.alert.recorded")}
              </p>
              <Button size="lg" className="h-14 w-full bg-white text-base text-red-800 hover:bg-white/90" onClick={onClose}>
                {t("ramadan.alert.close")}
              </Button>
            </div>
          ) : (
            <Button
              ref={doneRef}
              size="lg"
              className="h-16 w-full bg-white text-lg font-semibold text-red-800 hover:bg-white/90"
              onClick={done}
              disabled={saving}
            >
              {saving && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
              {t("ramadan.alert.done")}
            </Button>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded bg-white/15 px-3 py-2">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
