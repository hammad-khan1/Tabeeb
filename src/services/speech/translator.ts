import { getGroq, MODELS } from '@/lib/groq';
import { cleanMarkdownForSpeech } from './cleaner';

// Simple in-memory translation cache (keyed by clean text hash) to prevent duplicate Groq calls
const translationCache = new Map<string, { translatedText: string; timestamp: number }>();
const MAX_CACHE_ENTRIES = 100;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const URDU_MEDICAL_TRANSLATION_SYSTEM_PROMPT = `You are a certified healthcare translator specializing in Pakistani healthcare communication.
Your task is to faithfully translate the provided English clinical advice or health explanation into clear, natural Pakistani Urdu (اردو).

CRITICAL MEDICAL TRANSLATION RULES:
1. MEDICAL ACCURACY: Faithfully preserve all clinical information, findings, and medical advice without omitting, altering, or inventing facts.
2. PRESERVE NUMBERS & DOSAGES: Maintain exact numerical values, dosages, strengths, frequencies, durations, dates, and units (e.g. "500 mg", "1 tablet", "twice daily").
3. NEGATIONS & PROHIBITIONS: Negations and warnings MUST be strictly preserved. "Do not take", "avoid", or "never" must ALWAYS translate to clear Urdu prohibitions (e.g., "ہرگز نہ لیں", "نہ لیں", "پرہیز کریں"), NEVER positive or affirmative statements.
4. MEDICINE BRANDS & NAMES: Keep Pakistani and international medication brand names (such as Panadol, Augmentin, Lipiget, Glucophage, Calpol, etc.) clearly recognizable in everyday Pakistani Urdu phonetics (e.g., پیناڈول (Panadol), آگمینٹن (Augmentin)).
5. NATURAL HEALTHCARE URDU: Use vocabulary familiar to Pakistani patients (e.g., "خوراک" for dose, "دن میں دو بار" for twice a day, "کھانے کے بعد" for after meals, "پانی کے ساتھ" for with water).
6. UNAMBIGUOUS TERMINOLOGY: Retain common English medical terms where a literal Urdu term is obscure or confusing to patients (e.g., "blood pressure", "allergy", "mg").
7. PURE OUTPUT: Return ONLY the pure translated Urdu text. Do NOT include markdown code fences, conversational greetings, explanations, or preambles.`;

/**
 * Translates clinical text into natural Pakistani Urdu using Groq AI.
 * Adheres strictly to medical safety, negations, dosage preservation, and terminology familiar to Pakistani patients.
 */
export async function translateMedicalTextToUrdu(text: string): Promise<string> {
  const cleaned = cleanMarkdownForSpeech(text, { lang: 'en', expandUnits: false });
  if (!cleaned.trim()) {
    return '';
  }

  // Check cache
  const cacheKey = cleaned.trim();
  const cached = translationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.translatedText;
  }

  const groq = getGroq();

  try {
    const completion = await groq.chat.completions.create({
      model: MODELS.fast,
      messages: [
        {
          role: 'system',
          content: URDU_MEDICAL_TRANSLATION_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: cleaned,
        },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    });

    const translated = completion.choices[0]?.message?.content?.trim() || '';
    if (!translated) {
      throw new Error('Translation model returned an empty response');
    }

    // Clean any accidental markdown fences
    const cleanUrdu = translated
      .replace(/^```[a-zA-Z]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    // Cache result
    if (translationCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = translationCache.keys().next().value;
      if (oldestKey) translationCache.delete(oldestKey);
    }
    translationCache.set(cacheKey, {
      translatedText: cleanUrdu,
      timestamp: Date.now(),
    });

    return cleanUrdu;
  } catch (error) {
    // If fast model fails, attempt primary model as fallback
    try {
      const fallbackCompletion = await groq.chat.completions.create({
        model: MODELS.primary,
        messages: [
          {
            role: 'system',
            content: URDU_MEDICAL_TRANSLATION_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: cleaned,
          },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      });

      const fallbackText = fallbackCompletion.choices[0]?.message?.content?.trim() || '';
      if (!fallbackText) {
        throw new Error('Fallback translation model returned an empty response');
      }

      return fallbackText
        .replace(/^```[a-zA-Z]*\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
    } catch {
      throw new Error(
        `Unable to translate response to Urdu: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
