import { groq, MODELS } from '@/lib/groq';

export interface ImageExtractionResult {
  text: string;
  confidence: number;
  isHandwritten: boolean;
}

const OCR_SYSTEM_PROMPT = `You are a medical document OCR specialist. Extract ALL text from the provided image with high fidelity.

Rules:
- Extract every visible character, including Urdu script (preserve original script, do not transliterate)
- Preserve the layout structure: headings, tables, lists, and spacing as closely as possible
- For tables, use pipe-delimited format: | col1 | col2 | col3 |
- Note any sections that appear handwritten vs printed
- Include headers, footers, stamps, and watermarks text
- If text is unclear or ambiguous, mark it with [unclear: description]

Respond in this exact JSON format:
{
  "extractedText": "all extracted text here",
  "confidence": <number 0-100 estimating OCR accuracy>,
  "isHandwritten": <boolean - true if majority of content is handwritten>
}`;

export async function extractFromImage(buffer: Buffer): Promise<ImageExtractionResult> {
  const base64 = buffer.toString('base64');

  const response = await groq.chat.completions.create({
    model: MODELS.vision,
    messages: [
      { role: 'system', content: OCR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}` },
          },
          {
            type: 'text',
            text: 'Extract all text from this medical document image.',
          },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from vision model');
  }

  const parsed = JSON.parse(content) as {
    extractedText: string;
    confidence: number;
    isHandwritten: boolean;
  };

  return {
    text: parsed.extractedText,
    confidence: parsed.confidence ?? 50,
    isHandwritten: parsed.isHandwritten ?? false,
  };
}
