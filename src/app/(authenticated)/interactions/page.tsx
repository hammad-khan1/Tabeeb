"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  ShieldCheck,
  Pill,
  Search,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Info,
  AlertOctagon,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface InteractionResult {
  items: string[];
  severity: "info" | "mild" | "moderate" | "severe" | "contraindicated";
  description: string;
  /** Where the finding was derived from, so the reader can judge its weight. */
  source: "rxnorm_ingredient" | "rxnorm_class" | "allergy_record";
}

interface InteractionResponse {
  interactions: InteractionResult[];
  summary: string;
  recommendation: string;
  unverifiedItems: string[];
  limitations: string[];
}

const SOURCE_LABELS: Record<InteractionResult["source"], string> = {
  rxnorm_ingredient: "Same active ingredient · RxNorm",
  rxnorm_class: "Same drug class · ATC",
  allergy_record: "Matches your recorded allergy",
};

interface Medication {
  name: string;
  genericName?: string | null;
  dosage?: string | null;
  frequency?: string | null;
}

interface HistoryData {
  currentMedications: Medication[];
  allergies: Array<{ allergen: string; severity?: string | null }>;
}

const severityConfig: Record<
  string,
  { color: string; bgColor: string; borderColor: string; icon: React.ElementType; label: string }
> = {
  info: {
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    icon: Info,
    label: "Info",
  },
  mild: {
    color: "text-yellow-700",
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-200",
    icon: CheckCircle2,
    label: "Mild",
  },
  moderate: {
    color: "text-amber-700",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    icon: AlertTriangle,
    label: "Moderate",
  },
  severe: {
    color: "text-red-700",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
    icon: AlertOctagon,
    label: "Severe",
  },
  contraindicated: {
    color: "text-red-800",
    bgColor: "bg-red-100",
    borderColor: "border-red-300",
    icon: ShieldAlert,
    label: "Contraindicated",
  },
};

export default function InteractionsPage() {
  const { data: history, isLoading: historyLoading } =
    useSWR<HistoryData>("/api/history", fetcher);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InteractionResponse | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState("");

  const medications = history?.currentMedications ?? [];

  const handleCheck = async () => {
    if (!query.trim()) return;
    setIsChecking(true);
    setError("");
    setResults(null);

    try {
      const res = await fetch("/api/interactions/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Interaction check failed");
      }
      const data = await res.json();
      setResults(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsChecking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCheck();
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Interaction Checker
        </h1>
        <p className="text-muted-foreground">
          Check for drug, food, and supplement interactions with your current
          medications.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Panel: Current Medications */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Pill className="size-4" />
              Current Medications
            </CardTitle>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-lg bg-muted"
                  />
                ))}
              </div>
            ) : medications.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <Pill className="mb-3 size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  No medications on record.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Upload prescriptions to populate this list.
                </p>
              </div>
            ) : (
              <ScrollArea className="h-80">
                <div className="space-y-2">
                  {medications.map((med, i) => (
                    <div
                      key={i}
                      className="rounded-lg border p-3"
                    >
                      <p className="text-sm font-medium">{med.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[med.genericName, med.dosage, med.frequency]
                          .filter(Boolean)
                          .join(" | ")}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Right Panel: Query + Results */}
        <div className="space-y-4 lg:col-span-2">
          {/* Query Input */}
          <Card>
            <CardContent className="p-4">
              <label className="mb-2 block text-sm font-medium">
                Check an interaction
              </label>
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder='e.g. "Can I take ibuprofen?", "Is grapefruit safe?", "Vitamin D interactions"'
                  className="flex-1"
                />
                <Button
                  onClick={handleCheck}
                  disabled={isChecking || !query.trim()}
                >
                  {isChecking ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 size-4" />
                      Check
                    </>
                  )}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Ask about drugs, foods, or supplements and their interactions
                with your medications.
              </p>
            </CardContent>
          </Card>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="size-4" />
              {error}
            </div>
          )}

          {/* Loading State */}
          {isChecking && !results && (
            <Card>
              <CardContent className="flex flex-col items-center py-12">
                <Loader2 className="mb-3 size-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Analyzing interactions...
                </p>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {results && (
            <div className="space-y-4">
              {/* Summary */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Summary</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {results.summary}
                      </p>
                      <Separator className="my-3" />
                      <p className="text-sm">
                        <span className="font-medium">Recommendation: </span>
                        <span className="text-muted-foreground">
                          {results.recommendation}
                        </span>
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* What this check does not cover. Shown above the findings, because a
                  short "no interactions found" is misleading without it. */}
              {results.limitations.length > 0 && (
                <Card className="border-amber-500/40 bg-amber-500/5">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
                      <div className="space-y-2">
                        <p className="text-sm font-medium">What this check covers</p>
                        {results.limitations.map((limitation, i) => (
                          <p key={i} className="text-sm text-muted-foreground">
                            {limitation}
                          </p>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Interaction Cards */}
              {results.interactions.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center py-10 text-center">
                    <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                      <CheckCircle2 className="size-6" />
                    </div>
                    <p className="font-medium">Nothing flagged</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      No duplicate ingredient, drug class overlap or allergy match was
                      found among the items checked.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {results.interactions.map((interaction, i) => {
                    const config =
                      severityConfig[interaction.severity] ??
                      severityConfig.info;
                    const Icon = config.icon;

                    return (
                      <Card
                        key={i}
                        className={`${config.borderColor} border`}
                      >
                        <CardContent className={`p-4 ${config.bgColor}`}>
                          <div className="flex items-start gap-3">
                            <Icon
                              className={`mt-0.5 size-5 shrink-0 ${config.color}`}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={`${config.color} ${config.borderColor} text-[10px]`}
                                >
                                  {config.label}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {interaction.items.join(" + ")}
                                </span>
                              </div>
                              <p className="mt-2 text-sm">{interaction.description}</p>
                              <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">
                                {SOURCE_LABELS[interaction.source] ?? "Derived from your record"}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Empty state when no query made */}
          {!results && !isChecking && !error && (
            <Card>
              <CardContent className="flex flex-col items-center py-16 text-center">
                <ShieldCheck className="mb-4 size-12 text-muted-foreground/50" />
                <h3 className="text-lg font-semibold">Check Interactions</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Enter a drug, food, or supplement name above to check for
                  interactions with your current medications.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
