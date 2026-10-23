"use client";

import { useEffect, useState } from "react";
import { Camera, Keyboard, Loader2, Mic, Square } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/components/providers/locale-provider";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { postJson, request, type ConfirmableReading, type GlucoseResponse } from "./api";
import type { ActiveAlert } from "./break-fast-alert";

const SYMPTOMS = ["shaking", "sweating", "confusion", "fainting", "acute_illness"] as const;
type Mode = "type" | "voice" | "photo";
type Source = "typed" | "voice" | "photo";

const MODES: Array<{ id: Mode; icon: typeof Keyboard; label: TranslationKey }> = [
  { id: "type", icon: Keyboard, label: "ramadan.log.type" },
  { id: "voice", icon: Mic, label: "ramadan.log.voice" },
  { id: "photo", icon: Camera, label: "ramadan.log.photo" },
];

/** A plain number the patient typed, so it can be sent with the unit they chose. */
const PLAIN_NUMBER = /^\s*[\d۰-۹٠-٩]+(?:[.٫][\d۰-۹٠-٩]+)?\s*$/;

function toWesternDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace("٫", ".");
}

export function LogSugarDialog({
  open,
  onOpenChange,
  onLogged,
  onAlert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogged: () => void;
  onAlert: (alert: ActiveAlert) => void;
}) {
  const { t } = useLocale();
  const [mode, setMode] = useState<Mode>("type");
  const [text, setText] = useState("");
  const [unit, setUnit] = useState<"auto" | "mg_dl" | "mmol_l">("auto");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState<{ reading: ConfirmableReading; source: Source } | null>(null);
  const recorder = useVoiceRecorder();

  const reset = () => {
    setText("");
    setUnit("auto");
    setSymptoms([]);
    setError("");
    setSaved(false);
    setConfirming(null);
  };

  const handle = (outcome: GlucoseResponse, source: Source) => {
    if (outcome.status === "needs_confirmation") {
      setConfirming({ reading: outcome.reading, source });
      // A low or high is shown now, not after the question: the question can wait.
      if (outcome.provisionalAlert) {
        onAlert({
          message: outcome.provisionalAlert,
          logId: null,
          caregiverNotified: false,
          unconfirmed: { value: outcome.reading.value, unit: outcome.reading.unit, symptoms, source },
        });
        onOpenChange(false);
      }
      return;
    }

    onLogged();
    if (outcome.alert) {
      onAlert({ message: outcome.alert, logId: outcome.log.id, caregiverNotified: outcome.caregiverNotified });
      onOpenChange(false);
      reset();
    } else {
      setSaved(true);
      setText("");
      setSymptoms([]);
    }
  };

  const submit = async (body: Record<string, unknown>, source: Source) => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      handle(await postJson<GlucoseResponse>("/api/ramadan/glucose", { ...body, symptoms, source }), source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the reading.");
    } finally {
      setBusy(false);
    }
  };

  const submitTyped = () => {
    if (unit !== "auto" && PLAIN_NUMBER.test(text)) {
      return submit({ value: Number(toWesternDigits(text.trim())), unit }, "typed");
    }
    if (!text.trim() && symptoms.length > 0) return submit({}, "typed");
    return submit({ text }, "typed");
  };

  const confirm = () => {
    if (!confirming) return;
    const { reading, source } = confirming;
    setConfirming(null);
    submit({ value: reading.value, unit: reading.unit, confirmed: true }, source);
  };

  // A finished voice recording is transcribed, then logged like typed text.
  useEffect(() => {
    const blob = recorder.audioBlob;
    if (!blob) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const form = new FormData();
        form.append("audio", blob, "reading.webm");
        const { transcript } = await request<{ transcript: string }>("/api/voice/transcribe", {
          method: "POST",
          body: form,
        });
        if (cancelled) return;
        setText(transcript);
        handle(
          await postJson<GlucoseResponse>("/api/ramadan/glucose", { text: transcript, symptoms, source: "voice" }),
          "voice"
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not read the recording.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `handle` and `symptoms` are read once per recording, when it finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.audioBlob]);

  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("photo", file);
      handle(await request<GlucoseResponse>("/api/ramadan/glucose/photo", { method: "POST", body: form }), "photo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the photo.");
    } finally {
      setBusy(false);
    }
  };

  const toggleSymptom = (symptom: string) =>
    setSymptoms((current) =>
      current.includes(symptom) ? current.filter((s) => s !== symptom) : [...current, symptom]
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("ramadan.log.title")}</DialogTitle>
          <DialogDescription>{t("ramadan.log.placeholder")}</DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="space-y-4" aria-live="polite">
            <p className="text-base">{t("ramadan.log.confirm")}</p>
            <p className="text-4xl font-semibold tabular-nums" dir="ltr">
              {confirming.reading.value} {confirming.reading.unit === "mmol_l" ? "mmol/L" : "mg/dL"}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="h-14 flex-1 text-base" onClick={confirm} disabled={busy}>
                {t("ramadan.log.confirmYes")}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-14 flex-1 text-base"
                onClick={() => {
                  setConfirming(null);
                  setMode("type");
                  setText(String(confirming.reading.value));
                  setUnit(confirming.reading.unit);
                }}
              >
                {t("ramadan.log.confirmNo")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div role="tablist" aria-label={t("ramadan.log.title")} className="grid grid-cols-3 gap-2">
              {MODES.map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mode === id}
                  onClick={() => setMode(id)}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border-2 text-sm",
                    "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    mode === id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {t(label)}
                </button>
              ))}
            </div>

            <div role="tabpanel">
              {mode === "type" && (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <Label htmlFor="glucose-text">{t("ramadan.log.reading")}</Label>
                    <Input
                      id="glucose-text"
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && submitTyped()}
                      className="h-12 text-lg"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="glucose-unit">{t("ramadan.log.unit")}</Label>
                    <select
                      id="glucose-unit"
                      value={unit}
                      onChange={(event) => setUnit(event.target.value as typeof unit)}
                      className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
                    >
                      <option value="auto">—</option>
                      <option value="mg_dl">mg/dL</option>
                      <option value="mmol_l">mmol/L</option>
                    </select>
                  </div>
                </div>
              )}

              {mode === "voice" &&
                (recorder.isRecording ? (
                  <Button variant="destructive" size="lg" className="h-14 w-full text-base" onClick={recorder.stopRecording}>
                    <Square className="size-5" aria-hidden="true" />
                    {t("ramadan.log.stopAndSave")}
                  </Button>
                ) : (
                  <Button size="lg" className="h-14 w-full text-base" onClick={recorder.startRecording} disabled={busy}>
                    <Mic className="size-5" aria-hidden="true" />
                    {t("ramadan.log.record")}
                  </Button>
                ))}

              {mode === "photo" && (
                <label
                  className={cn(
                    "flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-base",
                    "focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted",
                    busy && "pointer-events-none opacity-60"
                  )}
                >
                  <Camera className="size-5" aria-hidden="true" />
                  {t("ramadan.log.choosePhoto")}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(event) => uploadPhoto(event.target.files?.[0])}
                  />
                </label>
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("ramadan.log.symptoms")}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {SYMPTOMS.map((symptom) => (
                  <label
                    key={symptom}
                    className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border px-3 hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={symptoms.includes(symptom)}
                      onChange={() => toggleSymptom(symptom)}
                    />
                    {t(`ramadan.symptom.${symptom}` as TranslationKey)}
                  </label>
                ))}
              </div>
            </fieldset>

            {mode === "type" && (
              <Button
                size="lg"
                className="h-14 w-full text-base"
                onClick={submitTyped}
                disabled={busy || (!text.trim() && symptoms.length === 0)}
              >
                {busy && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
                {t("ramadan.log.submit")}
              </Button>
            )}
            {busy && mode !== "type" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t("ramadan.log.working")}
              </p>
            )}
          </div>
        )}

        <div aria-live="polite">
          {saved && <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("ramadan.log.saved")}</p>}
          {(error || recorder.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error || recorder.error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
