/**
 * One list of what can be uploaded, shared by the upload UI's `accept` attribute, the
 * client-side pre-check, and the server-side validation. These used to be two lists
 * that disagreed: the picker blocked HEIC, WebP and TIFF that the extractor already
 * handled — and HEIC is the iPhone camera default, which is the main capture path
 * for photographing a prescription.
 */

export type FileKind = 'pdf' | 'image' | 'docx' | 'text';

export const SUPPORTED_FILE_TYPES = {
  'application/pdf': 'pdf',

  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/tiff': 'image',
  'image/bmp': 'image',
  'image/gif': 'image',
  'image/heic': 'image',
  'image/heif': 'image',

  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',

  'text/plain': 'text',
  'text/csv': 'text',
  'text/markdown': 'text',
  'text/tab-separated-values': 'text',
} as const satisfies Record<string, FileKind>;

export type SupportedMimeType = keyof typeof SUPPORTED_FILE_TYPES;

export const SUPPORTED_MIME_TYPES: ReadonlySet<string> = new Set(
  Object.keys(SUPPORTED_FILE_TYPES)
);

/**
 * Browsers report HEIC inconsistently and often send an empty type for it, so the
 * file picker also accepts by extension. Server-side validation still goes by MIME.
 */
export const UPLOAD_ACCEPT_ATTRIBUTE = [
  ...Object.keys(SUPPORTED_FILE_TYPES),
  '.heic',
  '.heif',
].join(',');

export const SUPPORTED_FILE_TYPES_LABEL = 'PDF, JPG, PNG, HEIC, WebP, TIFF, DOCX, TXT, CSV';

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  prescription: 'Prescription',
  lab_report: 'Lab Report',
  discharge_summary: 'Discharge Summary',
  imaging_report: 'Imaging Report',
  consultation_note: 'Consultation Note',
  voice_entry: 'Voice Entry',
  other: 'Other',
};
