import { SUPPORTED_FILE_TYPES, type FileKind } from '@/lib/constants';
import { extractFromPdf } from './pdf-extractor';
import { extractFromImage, ocrImage, type RadiologyFinding } from './image-extractor';
import type { ClassificationResult } from '@/services/radiology/classifier';
import type { RadiographDescription } from '@/services/radiology/medgemma-describer';
import { extractFromDocx } from './docx-extractor';

export interface ExtractionResult {
  text: string;
  isScanned?: boolean;
  isHandwritten?: boolean;
  confidence?: number;
  radiologyFindings?: RadiologyFinding[];
  /** Present for imaging documents: what the X-ray classifier did or could not check. */
  classification?: ClassificationResult;
  /** True when the image looked like a radiograph but was not filed as one. */
  detectedAsRadiograph?: boolean;
  /** Plain-language account of the image, for body parts the classifier cannot score. */
  radiographDescription?: RadiographDescription;
}

/** Dispatch is driven by the same map the uploader validates against, so the two cannot drift. */
function fileKindFor(mimeType: string): FileKind | null {
  return (SUPPORTED_FILE_TYPES as Record<string, FileKind>)[mimeType] ?? null;
}

const UNSUPPORTED_HINTS: Record<string, string> = {
  'application/msword':
    'Legacy .doc files are not supported. Please re-save the document as .docx or export it as a PDF.',
  'application/rtf':
    'RTF files are not supported. Please re-save the document as .docx or export it as a PDF.',
  'text/rtf':
    'RTF files are not supported. Please re-save the document as .docx or export it as a PDF.',
};

/**
 * Urdu records exported from Windows tooling are frequently windows-1256 rather than
 * UTF-8; decoding those bytes as UTF-8 yields mojibake, so fall back on validation failure.
 */
function decodeTextBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf-8');
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1256').decode(buffer);
  }
}

async function ocrPdfPages(pageImages: Buffer[]): Promise<ExtractionResult> {
  const pages: string[] = [];
  const confidences: number[] = [];
  let handwrittenPages = 0;

  for (const [index, pageImage] of pageImages.entries()) {
    const page = await ocrImage(pageImage, 'image/png');
    if (page.text.trim()) {
      pages.push(`-- page ${index + 1} of ${pageImages.length} --\n${page.text.trim()}`);
      confidences.push(page.confidence);
    }
    if (page.isHandwritten) handwrittenPages += 1;
  }

  const confidence = confidences.length
    ? Math.round(confidences.reduce((sum, c) => sum + c, 0) / confidences.length)
    : 0;

  return {
    text: pages.join('\n\n'),
    isScanned: true,
    isHandwritten: handwrittenPages > pageImages.length / 2,
    confidence,
  };
}

export async function extractText(
  buffer: Buffer,
  mimeType: string,
  documentType?: string
): Promise<ExtractionResult> {
  const normalizedMime = mimeType.toLowerCase().split(';')[0].trim();
  const kind = fileKindFor(normalizedMime);

  if (kind === 'pdf') {
    const result = await extractFromPdf(buffer);

    if (!result.isScanned) {
      return { text: result.text, isScanned: false };
    }

    if (!result.pageImages || result.pageImages.length === 0) {
      return { text: '', isScanned: true, confidence: 0 };
    }

    return ocrPdfPages(result.pageImages);
  }

  if (kind === 'image') {
    const result = await extractFromImage(buffer, normalizedMime, documentType);
    return {
      text: result.text,
      isHandwritten: result.isHandwritten,
      confidence: result.confidence,
      radiologyFindings: result.radiologyFindings,
      classification: result.classification,
      detectedAsRadiograph: result.detectedAsRadiograph,
      radiographDescription: result.radiographDescription,
    };
  }

  if (kind === 'docx') {
    const result = await extractFromDocx(buffer);
    return { text: result.text };
  }

  if (kind === 'text') {
    return { text: decodeTextBuffer(buffer) };
  }

  const hint = UNSUPPORTED_HINTS[normalizedMime];
  throw new Error(hint ?? `Unsupported file type: ${mimeType}`);
}
