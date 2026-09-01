"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import {
  Lightbulb,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Info,
  AlertOctagon,
  FileText,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface HealthFinding {
  category: string;
  title: string;
  detail: string;
  priority: "info" | "attention" | "action_needed";
}

interface InsightRecord {
  id: string;
  title: string;
  digest: string;
  findings: HealthFinding[];
  documentIdsReviewed: string[];
  priority: string;
  generatedAt: string;
}

const priorityConfig: Record<
  string,
  { color: string; bgColor: string; borderColor: string; label: string }
> = {
  normal: {
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
    label: "Normal",
  },
  elevated: {
    color: "text-amber-700",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    label: "Elevated",
  },
  urgent: {
    color: "text-red-700",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
    label: "Urgent",
  },
};

const findingPriorityIcons: Record<string, React.ElementType> = {
  info: Info,
  attention: AlertTriangle,
  action_needed: AlertOctagon,
};

const findingPriorityColors: Record<string, string> = {
  info: "text-blue-600",
  attention: "text-amber-600",
  action_needed: "text-red-600",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function InsightsPage() {
  const { data: insights, isLoading } = useSWR<InsightRecord[]>(
    "/api/insights",
    fetcher
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerateError("");
    try {
      const res = await fetch("/api/insights/generate", {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to generate insight");
      }
      await mutate("/api/insights");
    } catch (err: unknown) {
      setGenerateError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Health Insights</h1>
          <p className="text-muted-foreground">
            AI-generated digests analyzing patterns across your health records.
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 size-4" />
              Generate New Insight
            </>
          )}
        </Button>
      </div>

      {/* Error */}
      {generateError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="size-4" />
          {generateError}
        </div>
      )}

      {/* Generating indicator */}
      {isGenerating && (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Loader2 className="mb-3 size-8 animate-spin text-primary" />
            <p className="font-medium">Generating health insight...</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Analyzing your documents, medications, and lab results.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : !insights || insights.length === 0 ? (
        !isGenerating && (
          <Card>
            <CardContent className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Lightbulb className="size-7" />
              </div>
              <h3 className="text-lg font-semibold">No insights yet</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Upload medical documents first, then generate an insight to get
                an AI-powered analysis of your health records.
              </p>
              <Button className="mt-4" variant="outline" render={<a href="/documents/upload" />}>
                <FileText className="mr-2 size-4" />
                Upload Documents
              </Button>
            </CardContent>
          </Card>
        )
      ) : (
        <div className="space-y-4">
          {insights.map((insight) => {
            const config =
              priorityConfig[insight.priority] ?? priorityConfig.normal;
            const isExpanded = expandedId === insight.id;
            const findings = insight.findings ?? [];

            return (
              <Card key={insight.id} className={config.borderColor}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`${config.color} ${config.borderColor} text-[10px]`}
                        >
                          {config.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(insight.generatedAt)}
                        </span>
                      </div>
                      <CardTitle className="mt-2 text-base">
                        {insight.title}
                      </CardTitle>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : insight.id)
                      }
                    >
                      {isExpanded ? (
                        <ChevronUp className="size-4" />
                      ) : (
                        <ChevronDown className="size-4" />
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Truncated digest */}
                  <p className={`text-sm text-muted-foreground ${isExpanded ? "" : "line-clamp-2"}`}>
                    {insight.digest}
                  </p>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="mt-4 space-y-4">
                      <Separator />

                      {/* Findings */}
                      {findings.length > 0 && (
                        <div>
                          <h4 className="mb-3 text-sm font-semibold">
                            Key Findings
                          </h4>
                          <div className="space-y-2">
                            {findings.map((finding, i) => {
                              const Icon =
                                findingPriorityIcons[finding.priority] ?? Info;
                              const iconColor =
                                findingPriorityColors[finding.priority] ??
                                "text-muted-foreground";

                              return (
                                <div
                                  key={i}
                                  className="flex items-start gap-3 rounded-lg border p-3"
                                >
                                  <Icon
                                    className={`mt-0.5 size-4 shrink-0 ${iconColor}`}
                                  />
                                  <div>
                                    <p className="text-sm font-medium">
                                      {finding.title}
                                    </p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                      {finding.detail}
                                    </p>
                                    <Badge
                                      variant="outline"
                                      className="mt-1 text-[10px]"
                                    >
                                      {finding.category}
                                    </Badge>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Documents reviewed */}
                      {insight.documentIdsReviewed.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Based on {insight.documentIdsReviewed.length}{" "}
                            document{insight.documentIdsReviewed.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
