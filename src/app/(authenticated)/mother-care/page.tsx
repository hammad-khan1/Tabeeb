"use client";

import { useState } from "react";
import useSWR from "swr";
import { Baby, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { fetcher } from "@/lib/http-client";
import { cn } from "@/lib/utils";
import { StartForm } from "@/components/mother-care/start-form";
import { Dashboard } from "@/components/mother-care/dashboard";
import type { PregnancySummary } from "@/components/mother-care/types";

/**
 * Mother-care: a pregnancy companion. One account can hold more than one record — a
 * husband may keep his wife's — so the records are listed as profiles to switch between.
 */
export default function MotherCarePage() {
  const { t } = useLocale();
  const { data: records, error, mutate } = useSWR<PregnancySummary[]>("/api/pregnancy", fetcher);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const active = records?.find((record) => record.id === selected) ?? records?.[0] ?? null;

  let body: React.ReactNode;
  if (error) {
    body = (
      <p role="alert" className="text-destructive">
        {error instanceof Error ? error.message : t("error.title")}
      </p>
    );
  } else if (!records) {
    body = (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label={t("status.loading")} />
      </div>
    );
  } else if (!active || adding) {
    body = (
      <StartForm
        onCreated={async (id) => {
          setAdding(false);
          setSelected(id);
          await mutate();
        }}
      />
    );
  } else {
    body = (
      <Dashboard
        key={active.id}
        pregnancyId={active.id}
        onDeleted={async () => {
          setSelected(null);
          await mutate();
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Baby className="size-6 text-primary" aria-hidden="true" />
          {t("mother.title")}
        </h1>
        <p className="text-muted-foreground">{t("mother.subtitle")}</p>
      </header>

      {records && records.length > 0 && (
        <nav aria-label={t("mother.title")} className="flex flex-wrap gap-2">
          {records.map((record) => (
            <Button
              key={record.id}
              variant="outline"
              aria-current={!adding && active?.id === record.id ? "page" : undefined}
              className={cn("h-11", !adding && active?.id === record.id && "border-primary border-2")}
              onClick={() => {
                setAdding(false);
                setSelected(record.id);
              }}
            >
              {record.motherName}
            </Button>
          ))}
          <Button variant="ghost" className="h-11" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("mother.start.another")}
          </Button>
        </nav>
      )}

      {body}
    </div>
  );
}
