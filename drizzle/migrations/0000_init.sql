CREATE EXTENSION IF NOT EXISTS "vector";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('prescription', 'lab_report', 'discharge_summary', 'imaging_report', 'consultation_note', 'voice_entry', 'other');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('pending', 'processing', 'needs_review', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."interaction_severity" AS ENUM('info', 'mild', 'moderate', 'severe', 'contraindicated');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('en', 'ur', 'mixed');--> statement-breakpoint
CREATE TABLE "allergies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid,
	"user_id" varchar(255) NOT NULL,
	"allergen" varchar(500) NOT NULL,
	"allergy_type" varchar(100),
	"severity" varchar(100),
	"reaction" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"sources" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"condition" varchar(500) NOT NULL,
	"icd10_code" varchar(50),
	"severity" varchar(100),
	"notes" text,
	"diagnosed_date" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024),
	"token_count" integer NOT NULL,
	"section" varchar(100),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"title" varchar(500) NOT NULL,
	"document_type" "document_type" NOT NULL,
	"hospital" varchar(500),
	"doctor_name" varchar(255),
	"document_date" timestamp,
	"language" "language" DEFAULT 'mixed',
	"file_name" varchar(500) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"file_size" integer NOT NULL,
	"storage_path" varchar(1000) NOT NULL,
	"extraction_status" "extraction_status" DEFAULT 'pending',
	"processing_started_at" timestamp,
	"raw_extracted_text" text,
	"summary" text,
	"structured_data" jsonb,
	"extraction_confidence" integer,
	"extraction_notes" text,
	"is_handwritten" boolean DEFAULT false,
	"is_scanned_pdf" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "health_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"title" varchar(500) NOT NULL,
	"digest" text NOT NULL,
	"document_ids_reviewed" jsonb NOT NULL,
	"findings" jsonb NOT NULL,
	"priority" varchar(50) DEFAULT 'normal',
	"generated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "imaging_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"body_part" varchar(200) NOT NULL,
	"modality" varchar(100),
	"finding" text NOT NULL,
	"location" varchar(300),
	"severity" varchar(100),
	"description" text,
	"ai_confidence" integer,
	"urgency_level" varchar(50),
	"validation_notes" text,
	"validated" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "interaction_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"query_text" text NOT NULL,
	"items_checked" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"severity" "interaction_severity" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"test_name" varchar(500) NOT NULL,
	"canonical_test_name" varchar(200),
	"canonical_value" double precision,
	"canonical_unit" varchar(50),
	"value" varchar(100) NOT NULL,
	"numeric_value" double precision,
	"unit" varchar(100),
	"reference_range" varchar(255),
	"is_abnormal" boolean DEFAULT false,
	"test_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(500) NOT NULL,
	"generic_name" varchar(500),
	"dosage" varchar(255),
	"frequency" varchar(255),
	"duration" varchar(255),
	"route" varchar(100),
	"rxnorm_id" varchar(50),
	"is_active" boolean DEFAULT true,
	"prescribed_date" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"title" varchar(500),
	"document_ids" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"is_active" boolean DEFAULT true,
	"view_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"preferred_language" "language" DEFAULT 'en',
	"known_allergies" jsonb DEFAULT '[]'::jsonb,
	"known_conditions" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_insights" ADD CONSTRAINT "health_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_findings" ADD CONSTRAINT "imaging_findings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_findings" ADD CONSTRAINT "imaging_findings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_checks" ADD CONSTRAINT "interaction_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allergies_user_id_idx" ON "allergies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_messages_user_conv_idx" ON "chat_messages" USING btree ("user_id","conversation_id");--> statement-breakpoint
CREATE INDEX "chat_messages_created_idx" ON "chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "diagnoses_user_id_idx" ON "diagnoses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chunks_document_id_idx" ON "document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "chunks_user_id_idx" ON "document_chunks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "documents_user_id_idx" ON "documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("document_type");--> statement-breakpoint
CREATE INDEX "documents_date_idx" ON "documents" USING btree ("document_date");--> statement-breakpoint
CREATE INDEX "documents_hospital_idx" ON "documents" USING btree ("hospital");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("extraction_status");--> statement-breakpoint
CREATE INDEX "health_insights_user_idx" ON "health_insights" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "imaging_findings_user_idx" ON "imaging_findings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "imaging_findings_doc_idx" ON "imaging_findings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "interaction_checks_user_idx" ON "interaction_checks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lab_results_user_test_idx" ON "lab_results" USING btree ("user_id","test_name");--> statement-breakpoint
CREATE INDEX "lab_results_user_canonical_idx" ON "lab_results" USING btree ("user_id","canonical_test_name");--> statement-breakpoint
CREATE INDEX "lab_results_date_idx" ON "lab_results" USING btree ("test_date");--> statement-breakpoint
CREATE INDEX "medications_user_id_idx" ON "medications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "medications_document_id_idx" ON "medications" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "share_links_user_idx" ON "share_links" USING btree ("user_id");
--> statement-breakpoint
--
-- Retrieval indexes. Drizzle cannot express these, so they are appended by hand.
--
-- Dense arm: HNSW over cosine distance. Without this every chat question
-- sequentially scans the user's chunks.
CREATE INDEX IF NOT EXISTS "chunks_embedding_hnsw_idx"
  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
-- Lexical arm: 'simple' rather than 'english' because the corpus is mixed
-- English/Urdu and stemming mangles drug names and lab abbreviations.
CREATE INDEX IF NOT EXISTS "chunks_content_fts_idx"
  ON "document_chunks" USING gin (to_tsvector('simple', "content"));--> statement-breakpoint
-- Fuzzy arm: OCR of handwriting misspells the exact tokens users search for.
CREATE INDEX IF NOT EXISTS "chunks_content_trgm_idx"
  ON "document_chunks" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
-- Document list search (ILIKE '%term%' cannot use a btree index).
CREATE INDEX IF NOT EXISTS "documents_title_trgm_idx"
  ON "documents" USING gin ("title" gin_trgm_ops);
