import { format } from "date-fns";
import { RISK_ITEMS } from "@/services/ramadan/constants";
import type { SharedPlanSheet } from "@/services/ramadan/plan-sheet";
import { PrintButton } from "./print-button";

/**
 * The one page a patient hands their doctor before Ramzan. Written for the doctor, so
 * in English, and laid out to print on one sheet. It reports what is recorded and
 * what the patient answered; it suggests no dose.
 */

const BAND_LABEL = { low: "Low risk (0–3)", moderate: "Moderate risk (3.5–6)", high: "High risk (> 6)" } as const;

const SOURCE_LABEL = {
  record: "From record",
  answer: "Patient's answer",
  override: "Patient changed record value",
} as const;

const ALERT_LABEL: Record<string, string> = {
  none: "—",
  low: "Below 70 — alert",
  high: "Above 300 — alert",
  symptom: "Symptoms — alert",
};

function day(value: Date | string | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : format(date, "d MMM yyyy");
}

function dateTime(value: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function labels(item: string, option: string): { item: string; option: string } {
  const found = RISK_ITEMS.find((candidate) => candidate.id === item);
  return {
    item: found?.label ?? item,
    option: found?.options.find((candidate) => candidate.id === option)?.label ?? option,
  };
}

export function PlanSheetView({ shared }: { shared: SharedPlanSheet }) {
  const { sheet } = shared;
  const { plan } = sheet;
  const lows = sheet.glucose.filter((reading) => reading.alertLevel !== "none").length;

  return (
    <main className="min-h-screen bg-background print:bg-white">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-10 print:max-w-none print:px-0 print:py-0 print:text-sm">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Ramzan fasting plan sheet</p>
          <h1 className="text-3xl font-semibold tracking-tight">{sheet.patientName ?? "Patient"}</h1>
          <p className="text-sm text-muted-foreground">
            Ramzan {plan.year}: {day(plan.ramadanStart)} to {day(plan.ramadanEnd)}
            {plan.city ? ` · ${plan.city}` : ""} · Prepared {day(sheet.generatedAt)} · Link expires{" "}
            {day(shared.expiresAt)}
          </p>
          <PrintButton />
        </header>

        <section className="rounded-lg border-2 border-border p-4">
          <h2 className="text-lg font-semibold">IDF-DAR 2021 fasting risk</h2>
          {plan.riskBand && plan.riskScore !== null ? (
            <p className="mt-1 text-2xl font-semibold">
              {BAND_LABEL[plan.riskBand]} · score {plan.riskScore}
            </p>
          ) : (
            <p className="mt-1">
              No total yet: some items are unanswered or use guideline values still awaiting clinical
              verification. The answers recorded so far are below.
            </p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            Ramzan doses are for the treating doctor to set. Tabeeb has not changed or suggested any dose.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Score items and their sources</h2>
          {plan.scoreItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items recorded yet.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-start">
                  <th className="py-1.5 pe-2 text-start font-medium">Item</th>
                  <th className="py-1.5 pe-2 text-start font-medium">Answer</th>
                  <th className="py-1.5 pe-2 text-end font-medium">Points</th>
                  <th className="py-1.5 text-start font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {plan.scoreItems.map((entry) => {
                  const label = labels(entry.item, entry.option);
                  return (
                    <tr key={entry.item} className="border-b border-border align-top">
                      <td className="py-1.5 pe-2">{label.item}</td>
                      <td className="py-1.5 pe-2">{label.option}</td>
                      <td className="py-1.5 pe-2 text-end tabular-nums">{entry.points ?? "pending"}</td>
                      <td className="py-1.5 text-muted-foreground">
                        {SOURCE_LABEL[entry.source]}
                        {entry.provenance &&
                          `: ${entry.provenance.value}${entry.provenance.date ? `, ${entry.provenance.date}` : ""}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Current medicines, as recorded</h2>
          {sheet.medications.length === 0 ? (
            <p className="text-sm text-muted-foreground">None recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {sheet.medications.map((medicine, index) => (
                <li key={`${medicine.name}-${index}`}>
                  <span className="font-medium">{medicine.name}</span>
                  {medicine.genericName && medicine.genericName !== medicine.name && ` (${medicine.genericName})`}
                  {[medicine.dosage, medicine.frequency].filter(Boolean).length > 0 &&
                    ` — ${[medicine.dosage, medicine.frequency].filter(Boolean).join(", ")}`}
                  {medicine.prescribedDate && (
                    <span className="text-muted-foreground"> · {day(medicine.prescribedDate)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">HbA1c, last {sheet.hba1c.length || 3}</h2>
          {sheet.hba1c.length === 0 ? (
            <p className="text-sm text-muted-foreground">None recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm tabular-nums">
              {sheet.hba1c.map((result, index) => (
                <li key={index}>
                  {result.value}
                  {result.unit ? ` ${result.unit}` : ""} · {day(result.testDate)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Logged glucose, last 14 days</h2>
          {sheet.glucose.length === 0 ? (
            <p className="text-sm text-muted-foreground">No readings logged.</p>
          ) : (
            <>
              <p className="text-sm">
                {sheet.glucose.length} reading{sheet.glucose.length === 1 ? "" : "s"}, {lows} with a
                break-the-fast alert.
              </p>
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-1.5 pe-2 text-start font-medium">When (PKT)</th>
                    <th className="py-1.5 pe-2 text-end font-medium">mg/dL</th>
                    <th className="py-1.5 pe-2 text-start font-medium">Alert</th>
                    <th className="py-1.5 text-start font-medium">Symptoms / fast broken</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.glucose.map((reading, index) => (
                    <tr key={index} className="border-b border-border">
                      <td className="py-1.5 pe-2">{dateTime(reading.loggedAt)}</td>
                      <td className="py-1.5 pe-2 text-end">
                        {reading.valueMgDl === null ? "—" : Math.round(reading.valueMgDl)}
                      </td>
                      <td className="py-1.5 pe-2">{ALERT_LABEL[reading.alertLevel] ?? reading.alertLevel}</td>
                      <td className="py-1.5 text-muted-foreground">
                        {[reading.symptoms.join(", "), reading.fastBrokenAt ? `broke fast ${dateTime(reading.fastBrokenAt)}` : ""]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
          Prepared by Tabeeb from the patient&apos;s own records and answers, using the IDF-DAR Diabetes and
          Ramadan Practical Guidelines 2021. Not a diagnosis. Items marked &quot;pending&quot; use guideline
          values not yet clinically verified in this app. Tabeeb is a student project, not a certified medical
          device.
        </footer>
      </div>
    </main>
  );
}
