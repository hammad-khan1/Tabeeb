import { extractFromPdf } from './pdf-extractor';
import { extractFromImage } from './image-extractor';
import { extractFromDocx } from './docx-extractor';

export interface ExtractionResult {
  text: string;
  isScanned?: boolean;
  isHandwritten?: boolean;
  confidence?: number;
}

const PDF_MIMES = ['application/pdf'];
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/bmp'];
const DOCX_MIMES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const TEXT_MIMES = ['text/plain'];

export async function extractText(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractionResult> {
  if (PDF_MIMES.includes(mimeType)) {
    const result = await extractFromPdf(buffer);
    return { text: result.text, isScanned: result.isScanned };
  }

  if (IMAGE_MIMES.includes(mimeType)) {
    const result = await extractFromImage(buffer);
    return {
      text: result.text,
      isHandwritten: result.isHandwritten,
      confidence: result.confidence,
    };
  }

  if (DOCX_MIMES.includes(mimeType)) {
    const result = await extractFromDocx(buffer);
    return { text: result.text };
  }

  if (TEXT_MIMES.includes(mimeType)) {
    return { text: buffer.toString('utf-8') };
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}
