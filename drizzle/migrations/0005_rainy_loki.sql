ALTER TABLE "diagnoses" ADD COLUMN "canonical_condition" varchar(500);--> statement-breakpoint
CREATE INDEX "diagnoses_user_canonical_idx" ON "diagnoses" USING btree ("user_id","canonical_condition");