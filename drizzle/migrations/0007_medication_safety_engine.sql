CREATE TABLE "medication_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"medication_id" uuid,
	"finding_id" uuid,
	"action" varchar(64) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medication_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"finding_key" varchar(128) NOT NULL,
	"payload" jsonb NOT NULL,
	"evaluated_revision" varchar(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"review_status" varchar(32) DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"last_evaluated_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "observation" jsonb;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "source_key" varchar(128);--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "source_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "patient_status" varchar(40);--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "corrections" jsonb;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "medication_audit" ADD CONSTRAINT "medication_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_findings" ADD CONSTRAINT "medication_findings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "medication_audit_owner_date_idx" ON "medication_audit" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "medication_audit_medication_idx" ON "medication_audit" USING btree ("user_id","medication_id");--> statement-breakpoint
CREATE UNIQUE INDEX "medication_findings_owner_key_unique" ON "medication_findings" USING btree ("user_id","finding_key");--> statement-breakpoint
CREATE INDEX "medication_findings_owner_active_idx" ON "medication_findings" USING btree ("user_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "medication_findings_id_user_unique" ON "medication_findings" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_id_user_unique" ON "documents" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_document_owner_fk" FOREIGN KEY ("document_id","user_id") REFERENCES "public"."documents"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "medications_document_source_unique" ON "medications" USING btree ("document_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "medications_id_user_unique" ON "medications" USING btree ("id","user_id");--> statement-breakpoint
CREATE INDEX "medications_user_source_active_idx" ON "medications" USING btree ("user_id","source_active");