/**
 * The IDF-DAR 2021 fasting risk score. Pure: no I/O, no model.
 *
 * The score is only ever produced whole. A band built from some of the items reads as
 * lower risk than the patient carries — an unanswered "hypoglycaemia unawareness" is
 * worth more than every other item put together — so a missing answer, or an answer
 * whose points have not been verified against the guideline, returns `incomplete` with
 * the reasons rather than a total.
 */

import type { RamadanProvenance, RamadanScoreItem } from '../../../drizzle/schema';
import {
  RISK_BANDS,
  RISK_ITEMS,
  SCORE_STEP,
  type RiskBand,
  type RiskItem,
  type RiskItemId,
} from './constants';

export interface ScoreAnswer {
  item: RiskItemId;
  /** Option id from the item's options in constants.ts. */
  option: string;
  /** What the patient or the record said, in words, for the breakdown. */
  value: string;
  source: RamadanScoreItem['source'];
  provenance?: RamadanProvenance;
}

export type ScoreResult =
  | {
      status: 'complete';
      total: number;
      band: RiskBand;
      breakdown: RamadanScoreItem[];
    }
  | {
      status: 'incomplete';
      /** Items with no answer yet. */
      missing: RiskItemId[];
      /** Items answered with an option whose points are still TODO(verify). */
      unverified: RiskItemId[];
      breakdown: RamadanScoreItem[];
    };

export function bandFor(total: number): RiskBand {
  if (!Number.isFinite(total) || total < 0 || total % SCORE_STEP !== 0) {
    throw new RangeError(`Not a valid risk score: ${total}`);
  }
  if (total <= RISK_BANDS.lowMax) return 'low';
  if (total <= RISK_BANDS.moderateMax) return 'moderate';
  return 'high';
}

/**
 * Scores one answer per item. `items` is injectable so the arithmetic can be tested
 * against a fully filled-in table while the real one still has TODO(verify) values.
 */
export function scoreRisk(
  answers: readonly ScoreAnswer[],
  items: readonly RiskItem[] = RISK_ITEMS
): ScoreResult {
  const byItem = new Map<RiskItemId, ScoreAnswer>();
  for (const answer of answers) {
    // Two answers for one item means the caller has not resolved an override against
    // the record. Picking either silently could pick the lower-risk one.
    if (byItem.has(answer.item)) {
      throw new Error(`More than one answer for ${answer.item}`);
    }
    byItem.set(answer.item, answer);
  }

  const missing: RiskItemId[] = [];
  const unverified: RiskItemId[] = [];
  const breakdown: RamadanScoreItem[] = [];
  let total = 0;

  for (const item of items) {
    const answer = byItem.get(item.id);
    byItem.delete(item.id);

    if (!answer) {
      missing.push(item.id);
      continue;
    }

    const option = item.options.find((candidate) => candidate.id === answer.option);
    if (!option) {
      throw new Error(`Unknown option "${answer.option}" for ${item.id}`);
    }

    if (option.points === null) {
      unverified.push(item.id);
      continue;
    }

    total += option.points;
    breakdown.push({
      item: item.id,
      points: option.points,
      value: answer.value,
      source: answer.source,
      ...(answer.provenance ? { provenance: answer.provenance } : {}),
    });
  }

  const unknownItems = [...byItem.keys()];
  if (unknownItems.length > 0) {
    throw new Error(`Unknown risk item: ${unknownItems.join(', ')}`);
  }

  if (missing.length > 0 || unverified.length > 0) {
    return { status: 'incomplete', missing, unverified, breakdown };
  }

  return { status: 'complete', total, band: bandFor(total), breakdown };
}
