"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts";

const fetcher = (url: string) => fetch(url).then((r) => r.json());


interface DataPoint {
  value: number;
  date: string;
  referenceRange?: string;
}

interface TrendAnalysis {
  mean: number;
  stdDev: number;
  slope: number;
  trendDirection: "stable" | "rising" | "falling" | "fluctuating";
  anomalies: Array<{ index: number; value: number; deviation: number }>;
  referenceComparison: {
    withinRange: boolean;
    belowRange: number;
    aboveRange: number;
    rangeMin?: number;
    rangeMax?: number;
  } | null;
}

interface TrendResponse {
  dataPoints: DataPoint[];
  analysis: TrendAnalysis | null;
  rawResults: Array<{
    id: string;
    testName: string;
    value: string;
    numericValue: number | null;
    unit: string | null;
    referenceRange: string | null;
    isAbnormal: boolean | null;
    testDate: string;
  }>;
}

function parseRange(range?: string): { min: number; max: number } | null {
  if (!range) return null;
  const match = range.match(/([\d.]+)\s*[-\u2013\u2014]\s*([\d.]+)/);
  if (!match) return null;
  return { min: parseFloat(match[1]), max: parseFloat(match[2]) };
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

const trendIcons: Record<string, React.ElementType> = {
  rising: TrendingUp,
  falling: TrendingDown,
  stable: Minus,
  fluctuating: Activity,
};

const trendColors: Record<string, string> = {
  rising: "text-amber-600",
  falling: "text-blue-600",
  stable: "text-emerald-600",
  fluctuating: "text-purple-600",
};

interface AnalyteOption {
  key: string;
  display: string;
  unit: string | null;
  count: number;
}

export default function TrendsPage() {
  // The list comes from /api/trends rather than from raw testName values in the
  // history summary: analytes are deduplicated server-side, so "HbA1c", "HBA1C" and
  // "Glycated Haemoglobin" appear once instead of as three separate options.
  const { data: testList, isLoading: historyLoading } = useSWR<{ tests: AnalyteOption[] }>(
    "/api/trends",
    fetcher
  );

  const availableTests = useMemo(
    () => (testList?.tests ?? []).filter((t) => t.count > 0),
    [testList]
  );

  const [selectedTest, setSelectedTest] = useState<string>("");

  const { data: trendData, isLoading: trendLoading } = useSWR<TrendResponse>(
    selectedTest ? `/api/trends?test_name=${encodeURIComponent(selectedTest)}` : null,
    fetcher
  );

  // Build chart data
  const chartData = useMemo(() => {
    if (!trendData?.dataPoints) return [];
    return trendData.dataPoints.map((dp) => ({
      date: formatDate(dp.date),
      value: dp.value,
      rawDate: dp.date,
    }));
  }, [trendData]);

  const analysis = trendData?.analysis;
  const range = parseRange(
    trendData?.dataPoints?.[0]?.referenceRange
  );

  const anomalyIndices = useMemo(
    () => new Set(analysis?.anomalies?.map((a) => a.index) ?? []),
    [analysis]
  );

  const TrendIcon = analysis
    ? trendIcons[analysis.trendDirection] ?? Minus
    : Minus;
  const trendColor = analysis
    ? trendColors[analysis.trendDirection] ?? "text-muted-foreground"
    : "text-muted-foreground";

  if (historyLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-12 w-64 animate-pulse rounded bg-muted" />
        <div className="h-80 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Lab Trends</h1>
        <p className="text-muted-foreground">
          Track your lab test results over time and detect anomalies.
        </p>
      </div>

      {/* Test Selector */}
      <div className="max-w-xs">
        <Select value={selectedTest} onValueChange={(val) => val && setSelectedTest(val)}>
          <SelectTrigger>
            <SelectValue
              placeholder={
                availableTests.length > 0
                  ? "Select a lab test"
                  : "No lab tests available"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {availableTests.map((test) => (
              <SelectItem key={test.key} value={test.display}>
                {test.display}
                <span className="ml-2 text-muted-foreground tabular-nums">
                  {test.count}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedTest ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <TrendingUp className="mb-4 size-12 text-muted-foreground/50" />
            <h3 className="text-lg font-semibold">Select a Lab Test</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {availableTests.length > 0
                ? "Choose a lab test from the dropdown above to view its trend over time."
                : "No lab results available yet. Upload lab reports to see trends."}
            </p>
          </CardContent>
        </Card>
      ) : trendLoading ? (
        <div className="h-80 animate-pulse rounded-xl bg-muted" />
      ) : !trendData || chartData.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <TrendingUp className="mb-4 size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No data available for this test.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Chart */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{selectedTest}</CardTitle>
              {analysis && (
                <div className={`flex items-center gap-1.5 ${trendColor}`}>
                  <TrendIcon className="size-4" />
                  <span className="text-sm font-medium capitalize">
                    {analysis.trendDirection}
                  </span>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    stroke="#9ca3af"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="#9ca3af"
                    domain={
                      range
                        ? [
                            Math.min(range.min, ...chartData.map((d) => d.value)) * 0.9,
                            Math.max(range.max, ...chartData.map((d) => d.value)) * 1.1,
                          ]
                        : ["auto", "auto"]
                    }
                  />
                  <RechartsTooltip
                    contentStyle={{
                      borderRadius: "8px",
                      fontSize: "12px",
                      border: "1px solid #e5e7eb",
                    }}
                  />

                  {/* Reference range band */}
                  {range && (
                    <ReferenceArea
                      y1={range.min}
                      y2={range.max}
                      fill="#10b981"
                      fillOpacity={0.1}
                    />
                  )}
                  {range && (
                    <>
                      <ReferenceLine
                        y={range.min}
                        stroke="#10b981"
                        strokeDasharray="4 4"
                        strokeWidth={1}
                      />
                      <ReferenceLine
                        y={range.max}
                        stroke="#10b981"
                        strokeDasharray="4 4"
                        strokeWidth={1}
                      />
                    </>
                  )}

                  {/* Mean line */}
                  {analysis && (
                    <ReferenceLine
                      y={analysis.mean}
                      stroke="#6366f1"
                      strokeDasharray="6 3"
                      strokeWidth={1}
                      label={{
                        value: `Mean: ${analysis.mean.toFixed(1)}`,
                        position: "insideTopRight",
                        fontSize: 10,
                        fill: "#6366f1",
                      }}
                    />
                  )}

                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#0d9488"
                    strokeWidth={2}
                    dot={(props: Record<string, unknown>) => {
                      const { cx, cy, index } = props as { cx: number; cy: number; index: number };
                      const isAnomaly = anomalyIndices.has(index);
                      return (
                        <circle
                          key={`dot-${index}`}
                          cx={cx}
                          cy={cy}
                          r={isAnomaly ? 6 : 4}
                          fill={isAnomaly ? "#ef4444" : "#0d9488"}
                          stroke={isAnomaly ? "#fecaca" : "#ccfbf1"}
                          strokeWidth={2}
                        />
                      );
                    }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>

              {/* Anomaly legend */}
              {analysis && analysis.anomalies.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="size-3 rounded-full bg-red-500" />
                  <span>
                    {analysis.anomalies.length} anomal{analysis.anomalies.length === 1 ? "y" : "ies"} detected
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stats Summary */}
          {analysis && (
            <div className="grid gap-4 sm:grid-cols-4">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-xs text-muted-foreground">Mean</p>
                  <p className="text-xl font-bold">{analysis.mean.toFixed(1)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-xs text-muted-foreground">Min</p>
                  <p className="text-xl font-bold">
                    {Math.min(...chartData.map((d) => d.value)).toFixed(1)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-xs text-muted-foreground">Max</p>
                  <p className="text-xl font-bold">
                    {Math.max(...chartData.map((d) => d.value)).toFixed(1)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-xs text-muted-foreground">Reference</p>
                  <p className="text-xl font-bold">
                    {range
                      ? `${range.min}-${range.max}`
                      : "N/A"}
                  </p>
                  {analysis.referenceComparison && (
                    <Badge
                      variant={
                        analysis.referenceComparison.withinRange
                          ? "secondary"
                          : "destructive"
                      }
                      className="mt-1 text-[10px]"
                    >
                      {analysis.referenceComparison.withinRange
                        ? "Within range"
                        : "Out of range"}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Data Table */}
          {trendData.rawResults && trendData.rawResults.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">All Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-4">Date</th>
                        <th className="pb-2 pr-4">Value</th>
                        <th className="pb-2 pr-4">Reference</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendData.rawResults.map((result, i) => (
                        <tr key={result.id ?? i} className="border-b last:border-0">
                          <td className="py-2 pr-4">{formatDate(result.testDate)}</td>
                          <td className="py-2 pr-4 font-medium">
                            {result.value}
                            {result.unit ? ` ${result.unit}` : ""}
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {result.referenceRange ?? "N/A"}
                          </td>
                          <td className="py-2">
                            {result.isAbnormal ? (
                              <Badge
                                variant="destructive"
                                className="text-[10px]"
                              >
                                <AlertTriangle className="mr-1 size-3" />
                                Abnormal
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">
                                Normal
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
