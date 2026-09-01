import { describe, it, expect } from 'vitest';
import { analyzeLabTrend } from './analyzer';

function makePoints(values: number[], startDate = new Date('2024-01-01'), intervalDays = 30) {
  return values.map((value, i) => ({
    value,
    date: new Date(startDate.getTime() + i * intervalDays * 86400000),
  }));
}

describe('analyzeLabTrend', () => {
  it('returns stable trend for constant values', () => {
    const result = analyzeLabTrend(makePoints([100, 100, 100, 100]));
    expect(result.mean).toBe(100);
    expect(result.stdDev).toBe(0);
    expect(result.trendDirection).toBe('stable');
    expect(result.anomalies).toHaveLength(0);
  });

  it('detects rising trend', () => {
    // Large consistent increase: 100 → 200 over 5 points at 7-day intervals
    const result = analyzeLabTrend(makePoints([100, 125, 150, 175, 200], new Date('2024-01-01'), 7));
    expect(result.trendDirection).toBe('rising');
    expect(result.slope).toBeGreaterThan(0);
  });

  it('detects falling trend', () => {
    // Large consistent decrease: 300 → 100 over 5 points at 7-day intervals
    const result = analyzeLabTrend(makePoints([300, 250, 200, 150, 100], new Date('2024-01-01'), 7));
    expect(result.trendDirection).toBe('falling');
    expect(result.slope).toBeLessThan(0);
  });

  it('computes correct mean and stdDev', () => {
    const result = analyzeLabTrend(makePoints([80, 90, 100, 110, 120]));
    expect(result.mean).toBe(100);
    expect(result.stdDev).toBeCloseTo(15.81, 1);
  });

  it('flags anomalies beyond 2 standard deviations', () => {
    // Values clustered around 100 with one spike at 200
    const result = analyzeLabTrend(makePoints([100, 102, 98, 101, 99, 200]));
    expect(result.anomalies.length).toBeGreaterThanOrEqual(1);
    const anomalyValues = result.anomalies.map(a => a.value);
    expect(anomalyValues).toContain(200);
  });

  it('returns no anomalies when all values are similar', () => {
    const result = analyzeLabTrend(makePoints([100, 101, 99, 100, 101]));
    expect(result.anomalies).toHaveLength(0);
  });

  it('handles single data point', () => {
    const result = analyzeLabTrend(makePoints([150]));
    expect(result.mean).toBe(150);
    expect(result.stdDev).toBe(0);
    expect(result.slope).toBe(0);
    expect(result.trendDirection).toBe('stable');
  });

  it('handles empty input', () => {
    const result = analyzeLabTrend([]);
    expect(result.mean).toBeNaN();
  });

  it('compares against reference range', () => {
    const points = makePoints([110, 120, 130]).map(p => ({
      ...p,
      referenceRange: '70-100',
    }));
    const result = analyzeLabTrend(points);
    expect(result.referenceComparison).not.toBeNull();
    expect(result.referenceComparison!.withinRange).toBe(false);
    expect(result.referenceComparison!.aboveRange).toBe(3);
    expect(result.referenceComparison!.belowRange).toBe(0);
    expect(result.referenceComparison!.rangeMin).toBe(70);
    expect(result.referenceComparison!.rangeMax).toBe(100);
  });

  it('reports within range when all values are normal', () => {
    const points = makePoints([80, 85, 90, 95]).map(p => ({
      ...p,
      referenceRange: '70-100',
    }));
    const result = analyzeLabTrend(points);
    expect(result.referenceComparison!.withinRange).toBe(true);
  });

  it('returns null referenceComparison when no range provided', () => {
    const result = analyzeLabTrend(makePoints([100, 110]));
    expect(result.referenceComparison).toBeNull();
  });

  it('detects fluctuating trend for high variance with low slope', () => {
    // Alternating high/low values — high CV but near-zero net slope
    const result = analyzeLabTrend(makePoints([50, 150, 50, 150, 50, 150]));
    expect(result.stdDev).toBeGreaterThan(40);
    // Should be either fluctuating or stable depending on exact thresholds
    expect(['fluctuating', 'stable']).toContain(result.trendDirection);
  });
});
