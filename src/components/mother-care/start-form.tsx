"use client";

import { useState } from "react";
import useSWR from "swr";
import { Baby, FileSearch, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/components/providers/locale-provider";
import { fetcher, postJson } from "@/lib/http-client";
import { cn } from "@/lib/utils";
import type { DocumentSummary } from "./types";
import { displayDate } from "./types";

type DateMethod = "lmp" | "due" | "report";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "min-h-12 rounded-lg border-2 px-4 py-2 text-start text-base",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}

export function StartForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { t } = useLocale();
  const { data: docs } = useSWR<{ documents: DocumentSummary[] }>("/api/documents?limit=100", fetcher, {
    revalidateOnFocus: false,
  });

  const [motherName, setMotherName] = useState("");
  const [enteredBy, setEnteredBy] = useState<"self" | "family">("self");
  const [consent, setConsent] = useState(false);
  const [method, setMethod] = useState<DateMethod>("lmp");
  const [lmpDate, setLmpDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [reportId, setReportId] = useState("");
  const [candidates, setCandidates] = useState<Array<{ date: string; matched: string; ambiguous: boolean }> | null>(null);
  const [ttDoses, setTtDoses] = useState<string>("unknown");
  const [bloodGroup, setBloodGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const readReport = async () => {
    if (!reportId) return;
    setBusy(true);
    setError("");
    try {
      const result = await postJson<{ candidates: typeof candidates }>("/api/pregnancy/due-date", { documentId: reportId });
      setCandidates(result.candidates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the report.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const { pregnancy } = await postJson<{ pregnancy: { id: string } }>("/api/pregnancy", {
        motherName: motherName.trim(),
        enteredBy,
        consentConfirmed: enteredBy === "self" || consent,
        ...(method === "lmp" ? { lmpDate } : { dueDate }),
        ...(method === "report" && reportId ? { dueDateDocumentId: reportId } : {}),
        ttDosesBefore: ttDoses === "unknown" ? null : Number(ttDoses),
        bloodGroup: bloodGroup || null,
      });
      onCreated(pregnancy.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the record.");
    } finally {
      setBusy(false);
    }
  };

  const dateReady = method === "lmp" ? Boolean(lmpDate) : Boolean(dueDate);
  const ready = motherName.trim() && dateReady && (enteredBy === "self" || consent);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Baby className="size-5 text-primary" aria-hidden="true" />
          {t("mother.start.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="mother-name">{t("mother.start.name")}</Label>
          <Input id="mother-name" value={motherName} onChange={(e) => setMotherName(e.target.value)} className="h-12 text-base" />
        </div>

        <div className="space-y-2">
          <p id="who-label" className="text-sm font-medium">{t("mother.start.who")}</p>
          <div role="radiogroup" aria-labelledby="who-label" className="grid gap-2 sm:grid-cols-2">
            <Choice selected={enteredBy === "self"} onClick={() => setEnteredBy("self")}>
              {t("mother.start.self")}
            </Choice>
            <Choice selected={enteredBy === "family"} onClick={() => setEnteredBy("family")}>
              {t("mother.start.family")}
            </Choice>
          </div>
          {enteredBy === "family" && (
            <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md border border-border p-3">
              <input type="checkbox" className="mt-0.5 size-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{t("mother.start.consent")}</span>
            </label>
          )}
        </div>

        <div className="space-y-2">
          <p id="date-label" className="text-sm font-medium">{t("mother.start.dateMethod")}</p>
          <div role="radiogroup" aria-labelledby="date-label" className="grid gap-2 sm:grid-cols-3">
            <Choice selected={method === "lmp"} onClick={() => setMethod("lmp")}>{t("mother.start.lmp")}</Choice>
            <Choice selected={method === "due"} onClick={() => setMethod("due")}>{t("mother.start.due")}</Choice>
            <Choice selected={method === "report"} onClick={() => setMethod("report")}>{t("mother.start.report")}</Choice>
          </div>

          {method === "lmp" && (
            <Input aria-label={t("mother.start.lmp")} type="date" value={lmpDate} onChange={(e) => setLmpDate(e.target.value)} className="h-12" />
          )}
          {method === "due" && (
            <Input aria-label={t("mother.start.due")} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-12" />
          )}
          {method === "report" && (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  aria-label={t("mother.start.chooseReport")}
                  value={reportId}
                  onChange={(e) => {
                    setReportId(e.target.value);
                    setCandidates(null);
                  }}
                  className="h-12 flex-1 rounded-md border border-input bg-background px-3 text-base"
                >
                  <option value="">{t("mother.start.chooseReport")}</option>
                  {(docs?.documents ?? []).map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.title}
                      {doc.documentDate ? ` (${displayDate(doc.documentDate)})` : ""}
                    </option>
                  ))}
                </select>
                <Button variant="outline" className="h-12" onClick={readReport} disabled={!reportId || busy}>
                  <FileSearch className="size-4" aria-hidden="true" />
                  {t("mother.start.readReport")}
                </Button>
              </div>
              {candidates && candidates.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("mother.start.noDateFound")}</p>
              )}
              {candidates && candidates.length > 0 && (
                <div className="space-y-2" aria-live="polite">
                  <p className="text-sm">{t("mother.start.foundDate")}</p>
                  {candidates.map((candidate) => (
                    <Choice key={candidate.date} selected={dueDate === candidate.date} onClick={() => setDueDate(candidate.date)}>
                      <span className="font-medium">{displayDate(candidate.date)}</span>
                      <span className="block text-xs text-muted-foreground" dir="ltr">“{candidate.matched}”</span>
                      {candidate.ambiguous && <span className="block text-xs">{t("mother.start.ambiguous")}</span>}
                    </Choice>
                  ))}
                </div>
              )}
              <Input aria-label={t("mother.start.due")} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-12" />
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tt-before">{t("mother.start.tt")}</Label>
            <select
              id="tt-before"
              value={ttDoses}
              onChange={(e) => setTtDoses(e.target.value)}
              className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
            >
              <option value="unknown">{t("mother.start.ttUnknown")}</option>
              {[0, 1, 2, 3, 4, 5].map((count) => (
                <option key={count} value={count}>{count}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="blood-group">{t("mother.start.bloodGroup")}</Label>
            <select
              id="blood-group"
              value={bloodGroup}
              onChange={(e) => setBloodGroup(e.target.value)}
              className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
              dir="ltr"
            >
              <option value="">—</option>
              {BLOOD_GROUPS.map((group) => (
                <option key={group} value={group}>{group}</option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button size="lg" className="h-14 w-full text-base" onClick={submit} disabled={!ready || busy}>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {t("mother.start.submit")}
        </Button>
      </CardContent>
    </Card>
  );
}
