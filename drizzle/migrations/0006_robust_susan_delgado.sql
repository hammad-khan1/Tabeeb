CREATE TABLE "briefing_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"title" varchar(500),
	"document_ids" jsonb NOT NULL,
	"included_sections" jsonb DEFAULT '[]'::jsonb,
	"date_range_from" timestamp,
	"date_range_to" timestamp,
	"expires_at" timestamp NOT NULL,
	"is_active" boolean DEFAULT true,
	"view_count" integer DEFAULT 0,
	"last_viewed_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "briefing_share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "patient_doctors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"normalized_name" varchar(255),
	"specialty" varchar(255),
	"hospital" varchar(500),
	"contact_info" text,
	"source_type" varchar(50) DEFAULT 'extracted',
	"source_document_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "briefing_share_links" ADD CONSTRAINT "briefing_share_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_doctors" ADD CONSTRAINT "patient_doctors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_doctors" ADD CONSTRAINT "patient_doctors_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "briefing_share_links_user_idx" ON "briefing_share_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "briefing_share_links_token_idx" ON "briefing_share_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "patient_doctors_user_idx" ON "patient_doctors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "patient_doctors_user_name_idx" ON "patient_doctors" USING btree ("user_id","name");