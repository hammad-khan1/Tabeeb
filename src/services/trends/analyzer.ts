import { parseReferenceRange } from '@/lib/medical-values';

interface DataPoint {
  value: number;
  date: Date;
  referenceRange?: string;
}

interface Anomaly {
  index: number;
  value: number;
  deviation: number;
}

type TrendDirection = 'stable' | 'rising' | 'falling' | 'fluctuating';

interface ReferenceComparison {
  withinRange: boolean;
  belowRange: number;
  aboveRange: number;
  rangeMin?: number;
  rangeMax?: number;
}

export interface TrendAnalysisResult {
  mean: number;
  stdDev: number;
  slope: number;
  trendDirection: TrendDirection;
  anomalies: Anomaly[];
  referenceComparison: ReferenceComparison | null;
}

function computeMean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function computeStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function linearRegression(points: DataPoint[]): number {
  if (points.length < 2) return 0;

  const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sorted[0].date.getTime();

  const xs = sorted.map((p) => (p.date.getTime() - t0) / (1000 * 60 * 60 * 24));
  const ys = sorted.map((p) => p.value);

  const n = xs.length;
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = ys.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}

function classifyTrend(slope: number, stdDev: number, mean: number): TrendDirection {
  if (mean === 0 && stdDev === 0) return 'stable';

  const relativeSlope = Math.abs(slope) / (Math.abs(mean) || 1);
  const cv = stdDev / (Math.abs(mean) || 1);

  if (cv > 0.3 && relativeSlope < 0.01) return 'fluctuating';
  if (relativeSlope < 0.005) return 'stable';
  if (slope > 0) return 'rising';
  return 'falling';
}

function findAnomalies(values: number[], mean: number, stdDev: number): Anomaly[] {
  if (stdDev === 0) return [];

  return values
    .map((value, index) => {
      const deviation = Math.abs(value - mean) / stdDev;
      return { index, value, deviation };
    })
    .filter((a) => a.deviation > 2);
}

function compareReference(values: number[], referenceRange: string): ReferenceComparison | null {
  const parsed = parseReferenceRange(referenceRange);
  // A qualitative or unreadable range yields no comparison at all. Returning zero
  // counts here previously read as "nothing out of range", which is the opposite of
  // "could not tell".
  if (!parsed || (parsed.min === null && parsed.max === null)) return null;

  let belowRange = 0;
  let aboveRange = 0;

  for (const v of values) {
    if (parsed.min !== null && v < parsed.min) belowRange++;
    else if (parsed.max !== null && v > parsed.max) aboveRange++;
  }

  return {
    withinRange: belowRange === 0 && aboveRange === 0,
    belowRange,
    aboveRange,
    rangeMin: parsed.min ?? undefined,
    rangeMax: parsed.max ?? undefined,
  };
}

export function analyzeLabTrend(dataPoints: DataPoint[]): TrendAnalysisResult {
  const values = dataPoints.map((d) => d.value);
  const mean = computeMean(values);
  const stdDev = computeStdDev(values, mean);
  const slope = linearRegression(dataPoints);
  const trendDirection = classifyTrend(slope, stdDev, mean);
  const anomalies = findAnomalies(values, mean, stdDev);

  // Prefer the most recent range: labs change their reference intervals over time.
  const referenceRange = [...dataPoints]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .find((d) => d.referenceRange)?.referenceRange;
  const referenceComparison = referenceRange
    ? compareReference(values, referenceRange)
    : null;

  return {
    mean,
    stdDev,
    slope,
    trendDirection,
    anomalies,
    referenceComparison,
  };
}
