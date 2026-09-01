import mammoth from 'mammoth';

export interface DocxExtractionResult {
  text: string;
}

export async function extractFromDocx(buffer: Buffer): Promise<DocxExtractionResult> {
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value.trim() };
}
