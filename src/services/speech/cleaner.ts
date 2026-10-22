import type { SpeechPreparationOptions } from './types';

/**
 * Prepares raw assistant markdown responses into natural, speech-friendly text.
 * - Strips citations and raw URLs.
 * - Converts lists and headings into natural speech flow with pauses.
 * - Safely expands common medical abbreviations and units without mutating clinical values.
 */
export function cleanMarkdownForSpeech(
  markdown: string,
  options: SpeechPreparationOptions = {}
): string {
  if (!markdown || !markdown.trim()) return '';

  const { lang = 'en', expandUnits = true } = options;
  let text = markdown;

  // 1. Remove code blocks (keep contents or skip internal technical blocks)
  text = text.replace(/```[\s\S]*?```/g, (block) => {
    // If it's a code block, strip the language tag and backticks
    return block.replace(/```[a-zA-Z0-9_-]*\n?|```/g, ' ');
  });

  // 2. Remove inline code backticks
  text = text.replace(/`([^`]+)`/g, '$1');

  // 3. Remove citations like [Source 1], [Source 1, Source 2], [Source 1, 2], [1], [1, 2]
  text = text.replace(/\[(?:Source\s*\d+(?:\s*,\s*(?:Source\s*)?\d+)*|\d+(?:\s*,\s*\d+)*)\]/gi, '');
  text = text.replace(/\[Source:[^\]]+\]/gi, '');

  // 4. Transform Markdown links: [Label](url)
  // If label or target is a citation or url, remove entirely; otherwise retain the label
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
    const trimmedLabel = label.trim();
    const trimmedUrl = url.trim();
    if (
      /^source\s*\d+/i.test(trimmedLabel) ||
      /^#citation-/i.test(trimmedUrl) ||
      /^#citation-/i.test(trimmedLabel) ||
      /^https?:\/\//i.test(trimmedLabel)
    ) {
      return '';
    }
    return trimmedLabel;
  });

  // Also remove standalone (#citation-N) or leftover citation anchors
  text = text.replace(/\(#citation-\d+\)/gi, '');

  // 5. Remove standalone URLs
  text = text.replace(/https?:\/\/[^\s)]+/g, '');

  // 6. Handle Markdown tables: flatten cells into lines
  text = text.replace(/\|([^\n]+)\|/g, (_match, rowContent: string) => {
    // If it's a separator row (|---|---|), skip it
    if (/^[\s\-:|]+$/.test(rowContent)) return '';
    const cells = rowContent
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    return cells.join(', ') + '.';
  });

  // 7. Convert headings (# Heading) to spoken sentences with a pause
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_match, heading: string) => {
    const trimmed = heading.trim();
    // Ensure it ends with punctuation for a natural pause
    return /[.!?:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  });

  // 8. Convert bullet points (*, -, +) into sequential clauses
  text = text.replace(/^[\s]*[-*+]\s+(.+)$/gm, (_match, item: string) => {
    const trimmed = item.trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  });

  // 9. Convert numbered lists (1. Item) into sequential clauses
  text = text.replace(/^[\s]*\d+\.\s+(.+)$/gm, (_match, item: string) => {
    const trimmed = item.trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  });

  // 10. Remove blockquotes
  text = text.replace(/^>\s+/gm, '');

  // 11. Remove bold, italic, and strikethrough markers
  // Careful not to strip asterisks that are part of clinical numbers or wildcards
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');
  text = text.replace(/~~(.*?)~~/g, '$1');

  // 12. Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');

  // 13. Expand English medical units and abbreviations if requested
  if (lang === 'en' && expandUnits) {
    // Expand dosages and units: e.g. "500 mg" -> "500 milligrams", "1 tab" -> "1 tablet"
    text = text.replace(/\b(\d+(?:\.\d+)?)\s*mg\b/gi, '$1 milligrams');
    text = text.replace(/\b(\d+(?:\.\d+)?)\s*mcg\b/gi, '$1 micrograms');
    text = text.replace(/\b(\d+(?:\.\d+)?)\s*(?:ml|mL)\b/g, '$1 milliliters');
    text = text.replace(/\b(\d+(?:\.\d+)?)\s*g\b/gi, (_match, num: string) => {
      return Number(num) === 1 ? '1 gram' : `${num} grams`;
    });
    text = text.replace(/\b(\d+(?:\.\d+)?)\s*kg\b/gi, '$1 kilograms');
    text = text.replace(/\b(\d+(?:\.\d+)?)\s*(?:iu|IU)\b/g, '$1 international units');
    text = text.replace(/\b1\s*tabs?\b/gi, '1 tablet');
    text = text.replace(/\b(\d+(?:\.\d+)?)\s*tabs?\b/gi, '$1 tablets');
    text = text.replace(/\b1\s*caps?\b/gi, '1 capsule');
    text = text.replace(/\b(\d+(?:\.\d+)?)\s*caps?\b/gi, '$1 capsules');

    // Common prescription directions
    text = text.replace(/\b(?:b\.i\.d\.|bid)\b/gi, 'twice daily');
    text = text.replace(/\b(?:t\.i\.d\.|tid)\b/gi, 'three times daily');
    text = text.replace(/\b(?:q\.i\.d\.|qid)\b/gi, 'four times daily');
    text = text.replace(/\b(?:p\.o\.|po)\b/gi, 'by mouth');
    text = text.replace(/\b(?:p\.r\.n\.|prn)\b/gi, 'as needed');
  }

  // 14. Normalize whitespace and punctuation spacing
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\s+([.,!?:;۔،])/g, '$1');
  text = text.replace(/\n{2,}/g, '\n');
  text = text.trim();

  return text;
}

/**
 * Splits long text into natural sentence / clause chunks under a maximum character length
 * (e.g. 180 characters) to ensure Web Speech API utterances and TTS endpoints don't timeout.
 */
export function chunkTextForSpeech(text: string, maxChunkLength = 180): string[] {
  if (!text || !text.trim()) return [];

  // Split on sentence boundaries: English (. ! ?), Urdu (۔ ؟), or newlines
  const rawSentences = text
    .split(/(?<=[.!?۔؟\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const chunks: string[] = [];
  let current = '';

  for (const sentence of rawSentences) {
    if (!current) {
      if (sentence.length <= maxChunkLength) {
        current = sentence;
      } else {
        // Sentence itself is longer than maxChunkLength: split by commas or pauses
        const subParts = sentence.split(/(?<=[,،;:])\s+/);
        for (const sub of subParts) {
          if (!current) {
            current = sub;
          } else if ((current + ' ' + sub).length <= maxChunkLength) {
            current += ' ' + sub;
          } else {
            chunks.push(current.trim());
            current = sub;
          }
        }
      }
    } else if ((current + ' ' + sentence).length <= maxChunkLength) {
      current += ' ' + sentence;
    } else {
      chunks.push(current.trim());
      current = sentence;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}
