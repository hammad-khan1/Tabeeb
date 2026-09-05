/**
 * Assertion (ConText-style) detection: does the document say the patient HAS this, or
 * that they do not, or that their father did, or that they did years ago?
 *
 * The extractor reads entities off the page but not the stance the page takes on them.
 * "No history of diabetes", "father had diabetes" and "diabetic since 2019" all yield
 * the same entity, so a record built from extraction alone tells a doctor the patient
 * is diabetic on the strength of a line saying they are not. That is the single most
 * dangerous failure mode in this pipeline, and it is the one this module exists for.
 *
 * The algorithm is the classic ConText/NegEx shape: a cue lexicon, a scope that runs
 * from the cue to the end of its clause, and termination cues that cut the scope short.
 * Deterministic, offline, and easy to audit — which is what a safety filter should be.
 * Cues cover English, Urdu script and Roman Urdu, since a Pakistani discharge note
 * routinely mixes all three.
 */

import { normalizeUrdu, containsUrduScript, romanKey, MEDICAL_LEXICON } from './urdu';

export type AssertionStatus =
  /** The patient has it, as far as this document says. */
  | 'present'
  /** Explicitly denied or ruled out. */
  | 'absent'
  /** Belongs to a relative, not the patient. */
  | 'family'
  /** The patient's own, but in the past. */
  | 'historical'
  /** Conditional — advice about what to do if it happens. */
  | 'hypothetical'
  /** Hedged: suspected, probable, cannot be excluded. */
  | 'uncertain';

export interface Assertion {
  term: string;
  status: AssertionStatus;
  /** The words that decided it, for showing the patient why a finding was set aside. */
  cue: string | null;
  /** The sentence the decision was made in. */
  evidence: string;
}

type CueType = Exclude<AssertionStatus, 'present'>;
type Direction = 'forward' | 'backward';

interface Cue {
  pattern: RegExp;
  type: CueType;
  direction: Direction;
}

/**
 * How far a cue reaches, in words. ConText bounds scope by sentence alone, but OCR'd
 * documents lose sentence punctuation constantly, so a whole run-on line would fall
 * under one leading "no". The window is the backstop for that.
 */
const SCOPE_WINDOW = 8;

/** Priority when a term is asserted differently in different places. */
const STATUS_PRECEDENCE: AssertionStatus[] = [
  'present',
  'absent',
  'family',
  'hypothetical',
  'historical',
  'uncertain',
];

// ── Cue lexicons ────────────────────────────────────────────────────────────

/**
 * Negation. "History of" deliberately does NOT appear here: a past condition is still
 * the patient's, and treating it as absent would delete real history.
 */
const NEGATION_CUES: Cue[] = [
  { pattern: /\bno (?:evidence|sign|signs|history|complaints?|features?) of\b/g, type: 'absent', direction: 'forward' },
  { pattern: /\b(?:not|no|without|never had|denies|denied|denying|negative for|free of|absence of|ruled out for|nil)\b/g, type: 'absent', direction: 'forward' },
  { pattern: /\b(?:unremarkable|within normal limits|nad)\b/g, type: 'absent', direction: 'backward' },
  { pattern: /\b(?:was |were |is |are )?(?:ruled out|excluded|not detected|not seen|not found|negative)\b/g, type: 'absent', direction: 'backward' },
  { pattern: /(?:نہیں|کوئی نہیں|نفی)/g, type: 'absent', direction: 'backward' },
  { pattern: /\b(?:nahi|nahin|nahee|koi nahi)\b/g, type: 'absent', direction: 'backward' },
];

/** Somebody else's condition. */
const FAMILY_CUES: Cue[] = [
  { pattern: /\bfamily history(?: of)?\b/g, type: 'family', direction: 'forward' },
  { pattern: /\b(?:mother|father|brother|sister|sibling|siblings|parents?|grand(?:mother|father)|maternal|paternal|uncle|aunt|cousin)\b/g, type: 'family', direction: 'forward' },
  { pattern: /\bruns in the family\b/g, type: 'family', direction: 'backward' },
  { pattern: /(?:والد|والدہ|بھائی|بہن|خاندانی|خاندان میں|ماں|باپ)/g, type: 'family', direction: 'forward' },
  { pattern: /\b(?:walid|walida|bhai|behan|khandani|ammi|abbu)\b/g, type: 'family', direction: 'forward' },
];

/** The patient's own, but no longer current. */
const HISTORICAL_CUES: Cue[] = [
  { pattern: /\b(?:past (?:medical )?history|history of|h\/o|previously|formerly|in the past|since childhood|resolved|no longer|recovered from|status post|s\/p)\b/g, type: 'historical', direction: 'forward' },
  { pattern: /(?:ماضی میں|پہلے سے|پرانی)/g, type: 'historical', direction: 'forward' },
  { pattern: /\b(?:pehle|purani|purana|maazi)\b/g, type: 'historical', direction: 'forward' },
];

/** Advice about something that has not happened. */
const HYPOTHETICAL_CUES: Cue[] = [
  { pattern: /\b(?:if|in case of|should you|should there be|watch for|return if|come back if|at risk of|risk for|may develop|to prevent|prophylaxis for|in the event of)\b/g, type: 'hypothetical', direction: 'forward' },
  { pattern: /(?:اگر|صورت میں)/g, type: 'hypothetical', direction: 'forward' },
  { pattern: /\b(?:agar|khuda na khasta)\b/g, type: 'hypothetical', direction: 'forward' },
];

/** Hedged findings — recorded, but not as fact. */
const UNCERTAIN_CUES: Cue[] = [
  { pattern: /\b(?:possible|possibly|probable|probably|likely|suspected|suspicious for|question of|questionable|cannot (?:be )?exclude(?:d)?|rule out|r\/o|differential|versus|vs\.?|to be confirmed|impression of)\b/g, type: 'uncertain', direction: 'forward' },
  { pattern: /(?:ممکن|شبہ|امکان)/g, type: 'uncertain', direction: 'forward' },
  { pattern: /\b(?:mumkin|shayad|shubah)\b/g, type: 'uncertain', direction: 'forward' },
];

const ALL_CUES: Cue[] = [
  ...NEGATION_CUES,
  ...FAMILY_CUES,
  ...HISTORICAL_CUES,
  ...HYPOTHETICAL_CUES,
  ...UNCERTAIN_CUES,
];

/**
 * Words that end a cue's reach. Without these, "no chest pain but reports fever" marks
 * the fever as absent — the exact clause structure clinicians write in.
 */
const TERMINATION = /\b(?:but|however|although|though|except|aside from|apart from|nevertheless|whereas|while|yet still)\b|(?:لیکن|مگر|البتہ)|\b(?:lekin|magar|albatta)\b/g;

// ── Sentence and token handling ─────────────────────────────────────────────

/**
 * Newlines split sentences here as firmly as full stops do. Clinical documents are
 * written as lists, and OCR drops terminal punctuation constantly, so relying on
 * punctuation alone leaves an entire prescription as one "sentence".
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?:[.!?؟۔;]+\s*|\n+|•|•)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

interface Token {
  /** Normalised word, used for matching. */
  word: string;
  /** Character offset of the word in the normalised sentence. */
  start: number;
}

function normalizeSentence(sentence: string): string {
  return normalizeUrdu(sentence).toLowerCase();
}

function tokenize(sentence: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sentence)) !== null) {
    tokens.push({ word: match[0], start: match.index });
  }
  return tokens;
}

/** Word index containing (or immediately following) a character offset. */
function wordIndexAt(tokens: Token[], charIndex: number): number {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].start + tokens[i].word.length > charIndex) return i;
  }
  return tokens.length;
}

// ── Term variants ───────────────────────────────────────────────────────────

const LEXICON_BY_ENGLISH = new Map(
  MEDICAL_LEXICON.map((term) => [term.english.toLowerCase(), term])
);

/**
 * The strings that count as a mention of this term. An English condition also matches
 * its Urdu and Roman-Urdu spellings, so a negation written in Urdu still suppresses a
 * condition the extractor recorded in English.
 *
 * The longest word of a multi-word term is included as a fallback: documents write
 * "type 2 diabetes mellitus" in one place and "diabetes" in the next, and the whole
 * phrase would otherwise only match itself.
 */
function termVariants(term: string): string[] {
  const cleaned = normalizeSentence(term);
  if (!cleaned) return [];

  const variants = new Set<string>([cleaned]);

  const words = cleaned.split(/\s+/).filter((word) => !/^\d+$/.test(word));
  if (words.length > 1) {
    const longest = words.reduce((a, b) => (b.length > a.length ? b : a), '');
    if (longest.length >= 5) variants.add(longest);
  }

  const entry = LEXICON_BY_ENGLISH.get(cleaned);
  if (entry) {
    for (const spelling of entry.urdu) variants.add(normalizeUrdu(spelling));
    for (const spelling of entry.roman) variants.add(spelling.toLowerCase());
  }

  return [...variants];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word indices in this sentence where the term is mentioned. */
function findMentions(sentence: string, tokens: Token[], variants: string[]): number[] {
  const hits = new Set<number>();

  for (const variant of variants) {
    if (!variant) continue;

    if (containsUrduScript(variant)) {
      // Urdu has no case and the script provides its own boundaries; a plain scan is
      // both correct and cheaper than trying to fake word boundaries for it.
      let from = sentence.indexOf(variant);
      while (from !== -1) {
        hits.add(wordIndexAt(tokens, from));
        from = sentence.indexOf(variant, from + variant.length);
      }
      continue;
    }

    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(variant)}(?![\\p{L}\\p{N}])`, 'gu');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sentence)) !== null) {
      hits.add(wordIndexAt(tokens, match.index));
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
  }

  // Roman-Urdu spellings vary too much to match literally, so single tokens are also
  // compared on their phonetic key.
  const romanVariants = new Set(
    variants.filter((v) => !containsUrduScript(v) && !v.includes(' ')).map(romanKey).filter((key) => key.length >= 3)
  );
  if (romanVariants.size > 0) {
    tokens.forEach((token, index) => {
      if (romanVariants.has(romanKey(token.word))) hits.add(index);
    });
  }

  return [...hits].sort((a, b) => a - b);
}

// ── Scope resolution ────────────────────────────────────────────────────────

interface ScopedCue {
  type: CueType;
  text: string;
  from: number;
  to: number;
}

function terminationIndices(sentence: string, tokens: Token[]): number[] {
  const indices: number[] = [];
  TERMINATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TERMINATION.exec(sentence)) !== null) {
    indices.push(wordIndexAt(tokens, match.index));
    if (match.index === TERMINATION.lastIndex) TERMINATION.lastIndex += 1;
  }
  return indices;
}

function scopedCues(sentence: string, tokens: Token[]): ScopedCue[] {
  const stops = terminationIndices(sentence, tokens);
  const cues: ScopedCue[] = [];

  for (const cue of ALL_CUES) {
    cue.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = cue.pattern.exec(sentence)) !== null) {
      const startWord = wordIndexAt(tokens, match.index);
      const endWord = wordIndexAt(tokens, match.index + match[0].length - 1);

      if (cue.direction === 'forward') {
        const limit = stops.find((stop) => stop > endWord) ?? tokens.length;
        cues.push({
          type: cue.type,
          text: match[0],
          from: endWord + 1,
          to: Math.min(limit - 1, endWord + SCOPE_WINDOW),
        });
      } else {
        const stopsBefore = stops.filter((stop) => stop < startWord);
        const limit = stopsBefore.length > 0 ? stopsBefore[stopsBefore.length - 1] + 1 : 0;
        cues.push({
          type: cue.type,
          text: match[0],
          from: Math.max(limit, startWord - SCOPE_WINDOW),
          to: startWord - 1,
        });
      }

      if (match.index === cue.pattern.lastIndex) cue.pattern.lastIndex += 1;
    }
  }

  return cues;
}

function rank(status: AssertionStatus): number {
  const index = STATUS_PRECEDENCE.indexOf(status);
  return index === -1 ? STATUS_PRECEDENCE.length : index;
}

/** Of the cues covering this mention, the most consequential one wins. */
function statusForMention(cues: ScopedCue[], mention: number): { status: AssertionStatus; cue: string | null } {
  const covering = cues.filter((cue) => mention >= cue.from && mention <= cue.to);
  if (covering.length === 0) return { status: 'present', cue: null };

  const winner = covering.reduce((best, current) =>
    rank(current.type) < rank(best.type) ? current : best
  );
  return { status: winner.type, cue: winner.text };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Statuses that mean the finding is the patient's own. Everything else — denied,
 * a relative's, or advice about something that has not happened — must not become a
 * row in their health record.
 */
const PATIENT_OWN: ReadonlySet<AssertionStatus> = new Set<AssertionStatus>([
  'present',
  'historical',
  'uncertain',
]);

export function belongsToPatient(status: AssertionStatus): boolean {
  return PATIENT_OWN.has(status);
}

/**
 * How the document asserts one term.
 *
 * A term the text does not literally contain returns 'present': extraction routinely
 * rewords ("DM type II" becomes "Type 2 diabetes mellitus"), and silently dropping a
 * real diagnosis because the wording moved would be far worse than keeping one that a
 * cue might have qualified.
 */
export function detectAssertion(text: string, term: string): Assertion {
  const variants = termVariants(term);
  if (variants.length === 0) {
    return { term, status: 'present', cue: null, evidence: '' };
  }

  const found: Array<{ status: AssertionStatus; cue: string | null; evidence: string }> = [];

  for (const raw of splitSentences(text)) {
    const sentence = normalizeSentence(raw);
    const tokens = tokenize(sentence);
    const mentions = findMentions(sentence, tokens, variants);
    if (mentions.length === 0) continue;

    const cues = scopedCues(sentence, tokens);
    for (const mention of mentions) {
      const { status, cue } = statusForMention(cues, mention);
      found.push({ status, cue, evidence: raw.trim() });
    }
  }

  if (found.length === 0) return { term, status: 'present', cue: null, evidence: '' };

  // One unqualified mention is enough to call it present: a document that states the
  // condition plainly anywhere outweighs a hedge elsewhere.
  const best = found.reduce((a, b) => (rank(b.status) < rank(a.status) ? b : a));
  return { term, status: best.status, cue: best.cue, evidence: best.evidence };
}

/** Batch form. Keyed by the term exactly as it was passed in. */
export function detectAssertions(text: string, terms: string[]): Map<string, Assertion> {
  const result = new Map<string, Assertion>();
  for (const term of terms) {
    if (!term || result.has(term)) continue;
    result.set(term, detectAssertion(text, term));
  }
  return result;
}

export function isNegated(text: string, term: string): boolean {
  return detectAssertion(text, term).status === 'absent';
}

/** Patient-facing wording for why a finding was held back. */
export function describeAssertion(assertion: Assertion): string | null {
  const { term, status, cue, evidence } = assertion;
  const because = cue ? ` ("${cue}")` : '';
  const quote = evidence ? ` — "${evidence}"` : '';

  switch (status) {
    case 'absent':
      return `"${term}" was left out of your record because the document says you do not have it${because}${quote}.`;
    case 'family':
      return `"${term}" was recorded as family history, not your own${because}${quote}.`;
    case 'hypothetical':
      return `"${term}" appears as advice about what to do if it happens, not as something you have${because}${quote}.`;
    case 'historical':
      return `"${term}" is recorded as past history rather than a current problem${because}.`;
    case 'uncertain':
      return `"${term}" is written as a suspicion rather than a confirmed finding${because}.`;
    default:
      return null;
  }
}
