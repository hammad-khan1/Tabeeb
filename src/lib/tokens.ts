/**
 * Rough token accounting, used to budget chunk sizes and prompt context.
 *
 * Lives in lib rather than in the document processor because the RAG prompt builder
 * needs it too, and importing it from there would drag sharp, pdf-parse and the Groq
 * client into the chat request path.
 */

/** Arabic-script characters cost roughly one token per 2.5 chars vs 4 for Latin. */
export function estimateTokenCount(text: string): number {
  let arabicScript = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if ((codePoint >= 0x0600 && codePoint <= 0x06ff) || (codePoint >= 0xfb50 && codePoint <= 0xfdff)) {
      arabicScript += 1;
    }
  }
  const latinish = text.length - arabicScript;
  return Math.max(1, Math.ceil(arabicScript / 2.5 + latinish / 4));
}
