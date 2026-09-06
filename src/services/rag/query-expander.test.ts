import { describe, it, expect } from 'vitest';
import { expandQuery } from './query-expander';

describe('expandQuery', () => {
  it('adds the clinical vocabulary a document would use', () => {
    const result = expandQuery('what is my sugar level');
    expect(result.addedTerms).toEqual(expect.arrayContaining(['glucose', 'hba1c']));
    expect(result.lexicalQuery.startsWith('what is my sugar level')).toBe(true);
  });

  it('expands shorthand both ways', () => {
    expect(expandQuery('bp reading').addedTerms).toEqual(
      expect.arrayContaining(['blood', 'pressure'])
    );
    expect(expandQuery('hba1c').addedTerms).toEqual(expect.arrayContaining(['glycated']));
  });

  it('carries an Urdu question into English clinical terms', () => {
    const result = expandQuery('میری شوگر کتنی ہے');
    expect(result.addedTerms).toContain('diabetes');
    expect(result.lexicalQuery).toContain('شوگر');
  });

  it('reaches the catalogue name for a condition named the local way', () => {
    expect(expandQuery('shugar ka test').addedTerms).toEqual(
      expect.arrayContaining(['diabetes'])
    );
  });

  it('keeps the patient’s own words in every case', () => {
    for (const query of ['metformin 500mg', 'میری شوگر', 'bp']) {
      expect(expandQuery(query).lexicalQuery).toContain(query);
    }
  });

  it('adds nothing for a query with no known vocabulary', () => {
    const result = expandQuery('amlodipine');
    expect(result.addedTerms).toEqual([]);
    expect(result.lexicalQuery).toBe('amlodipine');
  });

  it('drops stopwords from the scoring terms', () => {
    expect(expandQuery('what is my dose').terms).not.toContain('what');
  });

  it('caps how much it adds', () => {
    const result = expandQuery('sugar diabetes cholesterol thyroid cbc lft kft bp scan');
    expect(result.addedTerms.length).toBeLessThanOrEqual(10);
  });

  it('handles an empty query without throwing', () => {
    expect(expandQuery('   ')).toEqual({ lexicalQuery: '', terms: [], addedTerms: [] });
  });
});
