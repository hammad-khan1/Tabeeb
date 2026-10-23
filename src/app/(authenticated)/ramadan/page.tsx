"use client";

import { useCallback, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Loader2, Moon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { fetcher, type PlanResponse } from "@/components/ramadan/api";
import { OptInCard } from "@/components/ramadan/opt-in-card";
import { RiskWizard } from "@/components/ramadan/risk-wizard";
import { RiskSummary } from "@/components/ramadan/risk-summary";
import { DailyView } from "@/components/ramadan/daily-view";
import { BreakFastAlert, type ActiveAlert } from "@/components/ramadan/break-fast-alert";

/**
 * Ramzan Mode: opt in, the risk check, the result with a link for the doctor, and the
 * daily Sehri/Iftar screen with sugar logging and break-the-fast alerts.
 */
export default function RamadanPage() {
  const { t } = useLocale();
  const { mutate: mutateKey } = useSWRConfig();
  const { data, error, mutate } = useSWR<PlanResponse>("/api/ramadan/plan", fetcher, {
    revalidateOnFocus: false,
  });

  const [editingPlan, setEditingPlan] = useState(false);
  const [wizard, setWizard] = useState<"pending" | "all" | null>(null);
  const [alert, setAlert] = useState<ActiveAlert | null>(null);

  const finishWizard = useCallback(() => {
    setWizard(null);
    mutateKey("/api/ramadan/risk");
  }, [mutateKey]);

  const plan = data?.plan ?? null;

  let body: React.ReactNode;
  if (error) {
    body = (
      <Card>
        <CardContent className="py-6 text-sm text-destructive" role="alert">
          {error instanceof Error ? error.message : t("error.title")}
        </CardContent>
      </Card>
    );
  } else if (!data) {
    body = (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label={t("status.loading")} />
      </div>
    );
  } else if (!plan || editingPlan) {
    body = (
      <OptInCard
        data={data}
        onSaved={(saved) => {
          setEditingPlan(false);
          mutate({ ...data, plan: saved });
          // A new plan starts with the questions the record could not answer.
          if (saved.intendsToFast && !plan) setWizard("pending");
          mutateKey("/api/ramadan/risk");
          mutateKey("/api/ramadan/today");
        }}
      />
    );
  } else if (!plan.intendsToFast) {
    body = (
      <Card>
        <CardContent className="space-y-4 py-6">
          <p>{t("ramadan.optIn.notFasting")}</p>
          <Button size="lg" className="h-12" onClick={() => setEditingPlan(true)}>
            {t("ramadan.optIn.change")}
          </Button>
        </CardContent>
      </Card>
    );
  } else if (wizard) {
    body = <RiskWizard mode={wizard} onDone={finishWizard} />;
  } else {
    body = (
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <RiskSummary onAnswer={setWizard} />
          <Button variant="link" className="px-0" onClick={() => setEditingPlan(true)}>
            {t("ramadan.optIn.change")}
          </Button>
        </div>
        <DailyView onAlert={setAlert} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Moon className="size-6 text-primary" aria-hidden="true" />
          {t("ramadan.title")}
        </h1>
        <p className="text-muted-foreground">{t("ramadan.subtitle")}</p>
      </header>

      {body}

      {alert && (
        <BreakFastAlert
          alert={alert}
          onClose={() => {
            setAlert(null);
            mutateKey("/api/ramadan/today");
          }}
        />
      )}
    </div>
  );
}
