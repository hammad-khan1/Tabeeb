-- Rebuild the lexical index with the 'english' text search configuration.
--
-- 0000 used 'simple' on the assumption that English stemming would mangle drug names.
-- Measured against real data, that assumption was wrong: stemming is applied
-- identically to the query and the document, so they still match each other —
--   Amlodipine -> amlodipin   (both sides)
--   Omeprazole -> omeprazol   (both sides)
--   Metformin  -> metformin   (unchanged)
-- while 'simple' indexes every English stopword, so "am I allergic to anything"
-- matched an unrelated Lab Results chunk on "I"/"to"/"anything" and outranked the
-- Allergies chunk.
--
-- Urdu is unaffected: both configurations tokenise it identically and an Urdu query
-- still matches an Urdu document under 'english'.
DROP INDEX IF EXISTS "chunks_content_fts_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_content_fts_idx"
  ON "document_chunks" USING gin (to_tsvector('english', "content"));
