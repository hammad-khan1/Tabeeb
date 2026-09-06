-- Composite indexes for the app's actual query shapes.
--
-- Every ordering the app does most often was falling back to a single-column index
-- and re-sorting: a user's documents by clinical date, their active medicines, their
-- most recent labs. The `assertion_status` columns drizzle-kit also proposed here are
-- omitted — migration 0002 adds them, and was hand-written, so the snapshot did not
-- know about it.

CREATE INDEX "diagnoses_user_date_idx" ON "diagnoses" USING btree ("user_id","diagnosed_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_user_date_idx" ON "documents" USING btree ("user_id","document_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "health_insights_user_generated_idx" ON "health_insights" USING btree ("user_id","generated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "imaging_findings_user_created_idx" ON "imaging_findings" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lab_results_user_date_idx" ON "lab_results" USING btree ("user_id","test_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "medications_user_active_idx" ON "medications" USING btree ("user_id","is_active","prescribed_date" DESC NULLS LAST);