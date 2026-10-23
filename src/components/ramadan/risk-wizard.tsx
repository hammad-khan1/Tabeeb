"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { ArrowLeft, Check, FileText, Loader2, Mic, Square } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { riskLabel, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { fetcher, postJson, request, type RamadanProvenance, type RiskResponse } from "./api";

function describeProvenance(provenance: RamadanProvenance): string {
  return provenance.date ? `${provenance.value} · ${provenance.date}` : provenance.value;
}

/**
 * One question per screen. In "pending" mode it asks only what the record could not
 * answer; in "all" mode it walks every item so the patient can change any answer,
 * including one the record filled. Each tap is saved at once, so leaving half-way
 * loses nothing.
 */
export function RiskWizard({ mode, onDone }: { mode: "pending" | "all"; onDone: () => void }) {
  const { t, locale } = useLocale();
  const { data, mutate } = useSWR<RiskResponse>("/api/ramadan/risk", fetcher, { revalidateOnFocus: false });

  // Fixed when the wizard opens, so answering does not reshuffle the list under the patient.
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  const recorder = useVoiceRecorder();
  const [heard, setHeard] = useState<string | null>(null);
  const [voiceOption, setVoiceOption] = useState<string | null>(null);
  const [interpreting, setInterpreting] = useState(false);

  if (data && questions === null) {
    setQuestions(mode === "all" ? data.riskItems.map((item) => item.id) : data.pending.map((input) => input.item));
  }

  const itemId = questions?.[index];
  const item = data?.riskItems.find((candidate) => candidate.id === itemId);
  const pending = data?.pending.find((input) => input.item === itemId);
  const filled = data?.filled.find((input) => input.item === itemId);
  const saved = data?.items.find((entry) => entry.item === itemId);

  // A finished recording is transcribed, then matched to one of this question's options.
  useEffect(() => {
    const blob = recorder.audioBlob;
    if (!blob || !itemId) return;
    let cancelled = false;

    (async () => {
      setInterpreting(true);
      setError("");
      try {
        const form = new FormData();
        form.append("audio", blob, "answer.webm");
        const { transcript } = await request<{ transcript: string }>("/api/voice/transcribe", {
          method: "POST",
          body: form,
        });
        if (cancelled) return;
        setHeard(transcript);
        const { option } = await postJson<{ option: string | null }>("/api/ramadan/risk/interpret", {
          item: itemId,
          transcript,
        });
        if (!cancelled) setVoiceOption(option);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not read your answer.");
      } finally {
        if (!cancelled) setInterpreting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recorder.audioBlob, itemId]);

  // Nothing to ask: the record and earlier answers already cover every item.
  const nothingToAsk = questions !== null && questions.length === 0;
  useEffect(() => {
    if (nothingToAsk) onDone();
  }, [nothingToAsk, onDone]);

  if (!data || !questions) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label={t("status.loading")} />
      </div>
    );
  }

  if (!item) return null;

  const goTo = (next: number) => {
    setHeard(null);
    setVoiceOption(null);
    setError("");
    if (next >= questions.length) onDone();
    else setIndex(Math.max(0, next));
  };

  const choose = async (option: string) => {
    setSaving(option);
    setError("");
    try {
      const updated = await postJson<RiskResponse>("/api/ramadan/risk", { answers: [{ item: item.id, option }] });
      await mutate(updated, { revalidate: false });
      goTo(index + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your answer.");
    } finally {
      setSaving(null);
    }
  };

  const selected = saved?.option ?? null;
  const suggested = voiceOption ?? pending?.suggestedOption ?? filled?.option ?? null;
  const hints = pending?.hints ?? (filled ? [filled.provenance] : []);
  const reasonKey = pending ? (`ramadan.risk.reason.${pending.reason}` as TranslationKey) : null;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t("ramadan.risk.question")} {index + 1} {t("ramadan.risk.of")} {questions.length}
        </p>
        <CardTitle id="risk-question" className="text-2xl leading-snug">
          {riskLabel(locale, item.label, item.id)}
        </CardTitle>
        {reasonKey && <p className="text-sm text-muted-foreground">{t(reasonKey)}</p>}
      </CardHeader>

      <CardContent className="space-y-5">
        {hints.length > 0 && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <p className="mb-1 flex items-center gap-1.5 font-medium">
              <FileText className="size-4" aria-hidden="true" />
              {t("ramadan.risk.fromRecord")}
            </p>
            <ul className="space-y-0.5 text-muted-foreground">
              {hints.map((hint) => (
                <li key={`${hint.table}:${hint.rowId}`}>{describeProvenance(hint)}</li>
              ))}
            </ul>
          </div>
        )}

        {suggested && suggested !== selected && (
          <p className="text-sm text-muted-foreground">{t("ramadan.risk.suggested")}</p>
        )}

        <div role="radiogroup" aria-labelledby="risk-question" className="grid gap-3">
          {item.options.map((option) => {
            const isSelected = option.id === selected;
            const isSuggested = option.id === suggested && !isSelected;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => choose(option.id)}
                disabled={saving !== null}
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 rounded-lg border-2 px-4 py-3 text-start text-base transition-colors",
                  "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  isSelected
                    ? "border-primary bg-primary/10"
                    : isSuggested
                      ? "border-primary/60 border-dashed"
                      : "border-border hover:bg-muted"
                )}
              >
                <span className="flex-1">{riskLabel(locale, option.label, item.id, option.id)}</span>
                {saving === option.id ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                ) : isSelected ? (
                  <Check className="size-5 text-primary" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {recorder.isRecording ? (
            <Button variant="destructive" size="lg" className="h-12" onClick={recorder.stopRecording}>
              <Square className="size-4" aria-hidden="true" />
              {t("ramadan.risk.stop")}
            </Button>
          ) : (
            <Button variant="outline" size="lg" className="h-12" onClick={recorder.startRecording} disabled={interpreting}>
              {interpreting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Mic className="size-4" aria-hidden="true" />
              )}
              {t("ramadan.risk.voice")}
            </Button>
          )}
          {index > 0 && (
            <Button variant="ghost" size="lg" className="h-12" onClick={() => goTo(index - 1)}>
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
              {t("ramadan.risk.back")}
            </Button>
          )}
        </div>

        <div aria-live="polite" className="space-y-1 text-sm">
          {heard && (
            <p>
              <span className="font-medium">{t("ramadan.risk.heard")}:</span> “{heard}”
            </p>
          )}
          {heard && !interpreting && voiceOption === null && (
            <p className="text-muted-foreground">{t("ramadan.risk.voiceNoMatch")}</p>
          )}
          {(error || recorder.error) && (
            <p role="alert" className="text-destructive">
              {error || recorder.error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
