import { describe, it, expect } from 'vitest';
import { scoreOverlap } from './reranker';

describe('scoreOverlap', () => {
  it('scores a chunk containing the query terms above one that does not', () => {
    const terms = ['metformin', 'dose'];
    const onTopic = scoreOverlap(terms, 'Metformin 500mg twice daily after meals.');
    const offTopic = scoreOverlap(terms, 'Chest X-ray shows clear lung fields.');
    expect(onTopic.coverage).toBeGreaterThan(offTopic.coverage);
    expect(onTopic.matched).toContain('metformin');
  });

  it('matches through punctuation and inflection', () => {
    expect(scoreOverlap(['metformin'], 'Tab. Metformin, 850mg').coverage).toBe(1);
    expect(scoreOverlap(['platelet'], 'Platelets 210 x10^9/L').coverage).toBe(1);
  });

  it('weights a number the patient named above a common word', () => {
    const withNumber = scoreOverlap(['hba1c', '7.2'], 'HbA1c 7.2 percent');
    expect(withNumber.coverage).toBe(1);
    // Only the common term matches, so coverage stays well below a full match.
    expect(scoreOverlap(['hba1c', '7.2'], 'HbA1c was measured').coverage).toBeLessThan(0.6);
  });

  it('does not match a short query term on an unrelated prefix', () => {
    expect(scoreOverlap(['hb'], 'Hbsag negative').matched).toEqual([]);
  });

  it('returns zero for an empty query rather than dividing by zero', () => {
    expect(scoreOverlap([], 'anything')).toEqual({ coverage: 0, matched: [] });
  });
});
