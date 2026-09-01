export type DocumentType =
  | 'prescription'
  | 'lab_report'
  | 'discharge_summary'
  | 'imaging_report'
  | 'consultation_note'
  | 'voice_entry'
  | 'other';

export type ExtractionStatus = 'pending' | 'processing' | 'needs_review' | 'confirmed' | 'failed';

export type Language = 'en' | 'ur' | 'mixed';

export interface DocumentRecord {
  id: string;
  userId: string;
  title: string;
  documentType: DocumentType;
  hospital: string | null;
  doctorName: string | null;
  documentDate: Date | null;
  language: Language;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  extractionStatus: ExtractionStatus;
  rawExtractedText: string | null;
  structuredData: Record<string, unknown> | null;
  extractionConfidence: number | null;
  extractionNotes: string | null;
  isHandwritten: boolean;
  isScannedPdf: boolean;
  createdAt: Date;
  updatedAt: Date;
}
