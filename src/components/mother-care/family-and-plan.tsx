"use client";

import { useState } from "react";
import { FileText, HeartHandshake, Loader2, QrCode, Trash2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/components/providers/locale-provider";
import { postJson, request } from "@/lib/http-client";
import { pakistanToday, type DocumentSummary, type PregnancyView } from "./types";

type Run = (key: string, action: () => Promise<unknown>) => Promise<void>;

function BirthPlan({ view, run, busy }: { view: PregnancyView; run: Run; busy: string | null }) {
  const { t } = useLocale();
  const saved = view.pregnancy.birthPlan ?? {};
  const [plan, setPlan] = useState({
    hospital: saved.hospital ?? "",
    transport: saved.transport ?? "",
    companion: saved.companion ?? "",
    moneySaved: saved.moneySaved ?? false,
    bloodDonor: saved.bloodDonor ?? "",
  });

  const text = (key: "hospital" | "transport" | "companion" | "bloodDonor", label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`plan-${key}`}>{label}</Label>
      <Input
        id={`plan-${key}`}
        value={plan[key]}
        onChange={(e) => setPlan({ ...plan, [key]: e.target.value })}
        className="h-11"
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <HeartHandshake className="size-5" aria-hidden="true" />
          {t("mother.plan.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("mother.plan.help")}</p>
        {text("hospital", t("mother.plan.hospital"))}
        {text("transport", t("mother.plan.transport"))}
        {text("companion", t("mother.plan.companion"))}
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={plan.moneySaved}
            onChange={(e) => setPlan({ ...plan, moneySaved: e.target.checked })}
          />
          {t("mother.plan.money")}
        </label>
        {text("bloodDonor", t("mother.plan.donor"))}
        <Button
          className="h-11"
          disabled={busy !== null}
          onClick={() => run("plan", () => postJson(`/api/pregnancy/${view.pregnancy.id}`, { birthPlan: plan }, "PATCH"))}
        >
          {t("mother.plan.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

function Family({ view, run, busy }: { view: PregnancyView; run: Run; busy: string | null }) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [phone, setPhone] = useState("");
  const base = `/api/pregnancy/${view.pregnancy.id}/caregivers`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="size-5" aria-hidden="true" />
          {t("mother.family.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("mother.family.help")}</p>

        <ul className="space-y-2">
          {view.caregivers.map((caregiver) => (
            <li key={caregiver.id} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{caregiver.name}</span>
                  {caregiver.relation && <span className="text-muted-foreground"> · {caregiver.relation}</span>}
                  <span className="block text-sm text-muted-foreground" dir="ltr">{caregiver.phone}</span>
                </span>
                <Button
                  variant="ghost"
                  className="h-10 text-destructive"
                  disabled={busy !== null}
                  onClick={() =>
                    run(`rm${caregiver.id}`, () => request(`${base}?caregiverId=${caregiver.id}`, { method: "DELETE" }))
                  }
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  {t("mother.family.remove")}
                </Button>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                {(["receivesReminders", "receivesAlerts"] as const).map((field) => (
                  <label key={field} className="flex min-h-10 items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={caregiver[field]}
                      disabled={busy !== null}
                      onChange={(e) =>
                        run(`cg${caregiver.id}`, () =>
                          postJson(base, { caregiverId: caregiver.id, [field]: e.target.checked }, "PATCH")
                        )
                      }
                    />
                    {t(field === "receivesReminders" ? "mother.family.reminders" : "mother.family.alerts")}
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>

        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label={t("mother.family.name")} placeholder={t("mother.family.name")} value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
          <Input aria-label={t("mother.family.relation")} placeholder={t("mother.family.relation")} value={relation} onChange={(e) => setRelation(e.target.value)} className="h-11" />
          <Input
            aria-label={t("mother.family.phone")}
            placeholder="+92 300 1234567"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-11"
          />
        </div>
        <Button
          className="h-11"
          disabled={!name.trim() || !phone.trim() || busy !== null}
          onClick={() =>
            run("addcg", async () => {
              await postJson(base, { name, relation: relation || null, phone });
              setName("");
              setRelation("");
              setPhone("");
            })
          }
        >
          {t("mother.family.add")}
        </Button>
      </CardContent>
    </Card>
  );
}

function Reports({
  view,
  documents,
  run,
  busy,
}: {
  view: PregnancyView;
  documents: DocumentSummary[];
  run: Run;
  busy: string | null;
}) {
  const { t } = useLocale();
  const linked = new Set(view.linkedDocuments.map((doc) => doc.id));
  const base = `/api/pregnancy/${view.pregnancy.id}/documents`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="size-5" aria-hidden="true" />
          {t("mother.docs.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("mother.docs.help")}</p>
        <ul className="space-y-1">
          {view.linkedDocuments.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-2">
              <span>{doc.title}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => run(`un${doc.id}`, () => request(`${base}?documentId=${doc.id}`, { method: "DELETE" }))}
              >
                {t("mother.docs.detach")}
              </Button>
            </li>
          ))}
        </ul>
        <select
          aria-label={t("mother.docs.attach")}
          value=""
          disabled={busy !== null}
          onChange={(e) => e.target.value && run("attach", () => postJson(base, { documentId: e.target.value }))}
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
        >
          <option value="">{t("mother.docs.attach")}</option>
          {documents
            .filter((doc) => !linked.has(doc.id))
            .map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.title}
              </option>
            ))}
        </select>
      </CardContent>
    </Card>
  );
}

export function FamilyAndPlan({
  view,
  documents,
  run,
  busy,
  onDeleted,
}: {
  view: PregnancyView;
  documents: DocumentSummary[];
  run: Run;
  busy: string | null;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [qr, setQr] = useState<{ url: string; qrSvg: string } | null>(null);
  const [birthOpen, setBirthOpen] = useState(false);
  const [birthDate, setBirthDate] = useState(pakistanToday());
  const id = view.pregnancy.id;

  return (
    <div className="space-y-4">
      {view.showBirthPlan && <BirthPlan view={view} run={run} busy={busy} />}

      <div className="grid gap-4 md:grid-cols-2">
        <Family view={view} run={run} busy={busy} />
        <Reports view={view} documents={documents} run={run} busy={busy} />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:flex-wrap">
          <Button
            variant="outline"
            size="lg"
            className="h-12"
            disabled={busy !== null}
            onClick={() =>
              run("qr", async () => setQr(await postJson<{ url: string; qrSvg: string }>(`/api/pregnancy/${id}/emergency`, {})))
            }
          >
            {busy === "qr" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <QrCode className="size-4" aria-hidden="true" />}
            {t("mother.summary.button")}
          </Button>

          {view.phase === "antenatal" && (
            <Button variant="outline" size="lg" className="h-12" onClick={() => setBirthOpen(!birthOpen)}>
              {t("mother.birth.button")}
            </Button>
          )}

          <Button
            variant="ghost"
            size="lg"
            className="h-12 text-destructive sm:ms-auto"
            disabled={busy !== null}
            onClick={() => window.confirm(t("mother.deleteConfirm")) && run("delete", onDeleted)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t("mother.delete")}
          </Button>

          {birthOpen && (
            <div className="flex w-full flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="birth-date">{t("mother.birth.date")}</Label>
                <Input id="birth-date" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="h-11" />
              </div>
              <Button
                className="h-11"
                disabled={busy !== null}
                onClick={() => run("birth", () => postJson(`/api/pregnancy/${id}`, { deliveredOn: birthDate }, "PATCH"))}
              >
                {t("mother.birth.save")}
              </Button>
            </div>
          )}

          {qr && (
            <div className="w-full space-y-2 rounded-lg border border-border p-4" aria-live="polite">
              <div
                className="mx-auto size-48 [&_svg]:size-full"
                role="img"
                aria-label={t("mother.summary.button")}
                // Generated by our own server from the summary link; contains no user input.
                dangerouslySetInnerHTML={{ __html: qr.qrSvg }}
              />
              <p className="text-center text-sm">{t("mother.hospital.qr")}</p>
              <p className="break-all text-center text-xs text-muted-foreground" dir="ltr">{qr.url}</p>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
