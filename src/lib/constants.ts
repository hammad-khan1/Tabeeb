export const SUPPORTED_FILE_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/jpg': 'image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text',
} as const;

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
