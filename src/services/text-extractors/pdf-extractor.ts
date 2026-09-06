
/**
 * Imported at call time, not module load.
 *
 * pdf.js evaluates browser-dependent code as its module is loaded, so a top-level
 * import made every upload — including images, which never touch a PDF — depend on it
 * succeeding. In production that surfaced as a 500 on uploading a photograph, with a
 * DOMMatrix stack trace that named nothing in this codebase.
 */
async function loadPdfParse() {
  const { PDFParse } = await import('pdf-parse');
  return PDFParse;
}

export interface PdfExtractionResult {
  text: string;
  isScanned: boolean;
  pageImages?: Buffer[];
}

const MIN_TEXT_CHARS = 50;
const RENDER_SCALE = 2;
const MAX_OCR_PAGES = 15;

/**
 * A PDF with no meaningful text layer is a scan or a photographed form. Rather than
 * dead-ending, render each page so the caller can run it through vision OCR.
 */
export async function extractFromPdf(buffer: Buffer): Promise<PdfExtractionResult> {
  const PDFParse = await loadPdfParse();
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const textResult = await parser.getText();
    const text = textResult.text.trim();

    if (text.length >= MIN_TEXT_CHARS) {
      return { text, isScanned: false };
    }

    const screenshots = await parser.getScreenshot({
      scale: RENDER_SCALE,
      imageBuffer: true,
      imageDataUrl: false,
      first: MAX_OCR_PAGES,
    });

    const pageImages = screenshots.pages
      .filter((page) => page.data && page.data.length > 0)
      .map((page) => Buffer.from(page.data));

    return { text: '', isScanned: true, pageImages };
  } finally {
    await parser.destroy();
  }
}
