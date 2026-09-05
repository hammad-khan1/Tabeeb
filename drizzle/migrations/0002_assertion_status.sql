-- Record how a document asserts a condition or an allergy.
--
-- Until now the pipeline stored every extracted entity as fact, so "no history of
-- diabetes" and "diabetic since 2019" produced the same row. A patient's record could
-- therefore state the opposite of what their document said, and the doctor-facing
-- one-look view would repeat it.
--
-- services/nlp/assertion classifies each mention; findings the document does not
-- attribute to the patient (denied, a relative's, or conditional advice) are no longer
-- written at all, and this column keeps the distinction between the ones that are —
-- current, historical, or suspected.
--
-- Existing rows predate the classifier and are left as 'present', which is what the
-- old pipeline assumed about all of them.
ALTER TABLE "diagnoses" ADD COLUMN IF NOT EXISTS "assertion_status" varchar(20) DEFAULT 'present';--> statement-breakpoint
ALTER TABLE "allergies" ADD COLUMN IF NOT EXISTS "assertion_status" varchar(20) DEFAULT 'present';
