CREATE TYPE "public"."pregnancy_due_date_source" AS ENUM('lmp', 'due_date', 'ultrasound_report');--> statement-breakpoint
CREATE TYPE "public"."pregnancy_entered_by" AS ENUM('self', 'family');--> statement-breakpoint
CREATE TYPE "public"."pregnancy_phase" AS ENUM('antenatal', 'postnatal');--> statement-breakpoint
CREATE TYPE "public"."pregnancy_status" AS ENUM('active', 'delivered', 'ended');--> statement-breakpoint
CREATE TYPE "public"."supplement_kind" AS ENUM('iron_folic', 'tt_dose');--> statement-breakpoint
CREATE TABLE "anc_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pregnancy_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"contact_number" integer NOT NULL,
	"planned_week" integer NOT NULL,
	"done_on" date,
	"document_id" uuid,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "bp_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pregnancy_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"systolic" integer NOT NULL,
	"diastolic" integer NOT NULL,
	"measured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "danger_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pregnancy_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"sign" varchar(50) NOT NULL,
	"phase" "pregnancy_phase" NOT NULL,
	"caregivers_notified" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pregnancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"mother_name" varchar(255) NOT NULL,
	"entered_by" "pregnancy_entered_by" NOT NULL,
	"consent_confirmed" boolean DEFAULT false NOT NULL,
	"lmp_date" date,
	"due_date" date NOT NULL,
	"due_date_source" "pregnancy_due_date_source" NOT NULL,
	"due_date_document_id" uuid,
	"blood_group" varchar(5),
	"past_complications" jsonb DEFAULT '[]'::jsonb,
	"tt_doses_before" integer,
	"birth_plan" jsonb DEFAULT '{}'::jsonb,
	"status" "pregnancy_status" DEFAULT 'active' NOT NULL,
	"delivered_on" date,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pregnancy_caregivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pregnancy_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"relation" varchar(50),
	"phone" varchar(50) NOT NULL,
	"receives_reminders" boolean DEFAULT true NOT NULL,
	"receives_alerts" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pregnancy_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pregnancy_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "supplement_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pregnancy_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"kind" "supplement_kind" NOT NULL,
	"taken_on" date NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "pregnancy_id" uuid;--> statement-breakpoint
ALTER TABLE "anc_contacts" ADD CONSTRAINT "anc_contacts_pregnancy_id_pregnancies_id_fk" FOREIGN KEY ("pregnancy_id") REFERENCES "public"."pregnancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anc_contacts" ADD CONSTRAINT "anc_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anc_contacts" ADD CONSTRAINT "anc_contacts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bp_readings" ADD CONSTRAINT "bp_readings_pregnancy_id_pregnancies_id_fk" FOREIGN KEY ("pregnancy_id") REFERENCES "public"."pregnancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bp_readings" ADD CONSTRAINT "bp_readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "danger_events" ADD CONSTRAINT "danger_events_pregnancy_id_pregnancies_id_fk" FOREIGN KEY ("pregnancy_id") REFERENCES "public"."pregnancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "danger_events" ADD CONSTRAINT "danger_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_due_date_document_id_documents_id_fk" FOREIGN KEY ("due_date_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregnancy_caregivers" ADD CONSTRAINT "pregnancy_caregivers_pregnancy_id_pregnancies_id_fk" FOREIGN KEY ("pregnancy_id") REFERENCES "public"."pregnancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregnancy_caregivers" ADD CONSTRAINT "pregnancy_caregivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregnancy_documents" ADD CONSTRAINT "pregnancy_documents_pregnancy_id_pregnancies_id_fk" FOREIGN KEY ("pregnancy_id") REFERENCES "public"."pregnancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregnancy_documents" ADD CONSTRAINT "pregnancy_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregnancy_documents" ADD CONSTRAINT "pregnancy_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_logs" ADD CONSTRAINT "supplement_logs_pregnancy_id_pregnancies_id_fk" FOREIGN KEY ("pregnancy_id") REFERENCES "public"."pregnancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_logs" ADD CONSTRAINT "supplement_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anc_contacts_pregnancy_contact_idx" ON "anc_contacts" USING btree ("pregnancy_id","contact_number");--> statement-breakpoint
CREATE INDEX "bp_readings_pregnancy_measured_idx" ON "bp_readings" USING btree ("pregnancy_id","measured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "danger_events_pregnancy_idx" ON "danger_events" USING btree ("pregnancy_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pregnancies_user_idx" ON "pregnancies" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pregnancy_documents_pregnancy_document_idx" ON "pregnancy_documents" USING btree ("pregnancy_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplement_logs_pregnancy_kind_day_idx" ON "supplement_logs" USING btree ("pregnancy_id","kind","taken_on");--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_pregnancy_id_pregnancies_id_fk" FOREIGN KEY ("pregnancy_id") REFERENCES "public"."pregnancies"("id") ON DELETE cascade ON UPDATE no action;