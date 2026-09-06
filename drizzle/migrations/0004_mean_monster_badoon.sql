-- Drop imaging_findings.
--
-- The table stored AI-generated X-ray pathology findings. That feature is not part of
-- the product: the specification's vision requirement is OCR of handwritten
-- prescriptions and printed lab reports, not diagnostic reading of films. Imaging
-- *reports* remain a document type — a radiologist's written report is a document a
-- patient holds — but nothing generates findings from an image any more.

DROP TABLE "imaging_findings" CASCADE;