import { PDFParse } from 'pdf-parse';

export interface PdfExtractionResult {
  text: string;
  isScanned: boolean;
}

export async function extractFromPdf(buffer: Buffer): Promise<PdfExtractionResult> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const textResult = await parser.getText();
    const text = textResult.text.trim();

    if (text.length < 50) {
      return { text: '', isScanned: true };
    }

    return { text, isScanned: false };
  } finally {
    await parser.destroy();
  }
}
