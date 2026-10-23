import type { EmergencySummary } from "@/services/pregnancy/pregnancy";
import { PrintButton } from "@/components/ramadan/print-button";

/**
 * What the emergency doctor sees after scanning the QR code: the facts that matter in
 * the first minutes, on one page. In English, for the doctor. It reports what was
 * recorded and makes no assessment.
 */

function day(value: string | Date | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function dateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 border-b border-border py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function EmergencySummaryView({ shared }: { shared: { expiresAt: Date; summary: EmergencySummary } }) {
  const { summary } = shared;
  const status =
    summary.phase === "antenatal"
      ? `Pregnant, ${summary.weeks} weeks`
      : summary.deliveredOn
        ? `Delivered ${day(summary.deliveredOn)}`
        : "After delivery";

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-10 print:px-0 print:py-0">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-red-700 dark:text-red-400">Pregnancy emergency summary</p>
          <h1 className="text-3xl font-semibold tracking-tight">{summary.motherName}</h1>
          <p className="text-lg font-medium">{status}</p>
          <p className="text-sm text-muted-foreground">
            Prepared {dateTime(summary.generatedAt)} PKT · Link expires {dateTime(shared.expiresAt)}
          </p>
          <PrintButton />
        </header>

        {summary.recentDangerSigns.length > 0 && (
          <section className="rounded-lg border-2 border-red-600/50 bg-red-600/5 p-4">
            <h2 className="font-semibold">Danger signs she reported</h2>
            <ul className="mt-1 space-y-0.5 text-sm">
              {summary.recentDangerSigns.map((sign, index) => (
                <li key={index}>
                  {sign.text} — {dateTime(sign.at)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <dl>
          <Row label="Due date">{day(summary.dueDate)}</Row>
          <Row label="Blood group">{summary.bloodGroup ?? "Not recorded"}</Row>
          <Row label="Past complications">
            {summary.pastComplications.length > 0 ? summary.pastComplications.join(", ") : "None recorded"}
          </Row>
          <Row label="Haemoglobin">
            {summary.hb.length === 0
              ? "No reports linked"
              : summary.hb.map((reading, index) => (
                  <span key={index} className="block tabular-nums">
                    {reading.value} {reading.unit} · {day(reading.testDate)}
                  </span>
                ))}
          </Row>
          <Row label="Blood pressure">
            {summary.bp.length === 0
              ? "No readings recorded"
              : summary.bp.map((reading, index) => (
                  <span key={index} className="block tabular-nums">
                    {reading.systolic}/{reading.diastolic} · {dateTime(reading.measuredAt)}
                  </span>
                ))}
          </Row>
          <Row label="Tetanus (TT/Td)">
            {summary.ttDosesBefore === null ? "Doses before pregnancy unknown" : `${summary.ttDosesBefore} doses before pregnancy`}
            {summary.tetanus
              .filter((dose) => dose.status === "given")
              .map((dose) => (
                <span key={dose.number} className="block">
                  Dose {dose.number} given {day(dose.givenOn)}
                </span>
              ))}
          </Row>
          <Row label="Iron and folic acid">{summary.ironDaysTaken} days logged as taken</Row>
        </dl>

        <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
          Recorded by the patient or her family in Tabeeb. Values are as entered or read from her linked reports; nothing
          here is a diagnosis. Tabeeb is a student project, not a certified medical device.
        </footer>
      </div>
    </main>
  );
}
