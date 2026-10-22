CREATE TYPE "public"."glucose_alert_level" AS ENUM('none', 'low', 'high', 'symptom');--> statement-breakpoint
CREATE TYPE "public"."glucose_source" AS ENUM('typed', 'voice', 'photo');--> statement-breakpoint
CREATE TYPE "public"."glucose_unit" AS ENUM('mg_dl', 'mmol_l');--> statement-breakpoint
CREATE TYPE "public"."ramadan_plan_status" AS ENUM('draft', 'active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."ramadan_reminder_kind" AS ENUM('medicine', 'glucose_check', 'sehri', 'iftar');--> statement-breakpoint
CREATE TYPE "public"."ramadan_slot" AS ENUM('sehri', 'midday', 'pre_iftar', 'iftar', 'post_iftar', 'bedtime');--> statement-breakpoint
CREATE TYPE "public"."ramadan_risk_band" AS ENUM('low', 'moderate', 'high');--> statement-breakpoint
CREATE TABLE "glucose_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"plan_id" uuid,
	"value_mg_dl" double precision,
	"original_text" text,
	"original_unit" "glucose_unit",
	"source" "glucose_source" NOT NULL,
	"symptoms" jsonb DEFAULT '[]'::jsonb,
	"logged_at" timestamp DEFAULT now() NOT NULL,
	"alert_level" "glucose_alert_level" DEFAULT 'none' NOT NULL,
	"fast_broken_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ramadan_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"year" integer NOT NULL,
	"ramadan_start" date NOT NULL,
	"ramadan_end" date NOT NULL,
	"city" varchar(100),
	"latitude" double precision,
	"longitude" double precision,
	"intends_to_fast" boolean,
	"risk_score" double precision,
	"risk_band" "ramadan_risk_band",
	"score_items" jsonb DEFAULT '[]'::jsonb,
	"doctor_confirmed" boolean DEFAULT false,
	"doctor_plan_document_id" uuid,
	"caregiver_name" varchar(255),
	"caregiver_phone" varchar(50),
	"status" "ramadan_plan_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ramadan_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"plan_id" uuid NOT NULL,
	"kind" "ramadan_reminder_kind" NOT NULL,
	"medication_id" uuid,
	"label" varchar(500) NOT NULL,
	"slot" "ramadan_slot" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "ramadan_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "glucose_logs" ADD CONSTRAINT "glucose_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glucose_logs" ADD CONSTRAINT "glucose_logs_plan_id_ramadan_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."ramadan_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ramadan_plans" ADD CONSTRAINT "ramadan_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ramadan_plans" ADD CONSTRAINT "ramadan_plans_doctor_plan_document_id_documents_id_fk" FOREIGN KEY ("doctor_plan_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ramadan_reminders" ADD CONSTRAINT "ramadan_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ramadan_reminders" ADD CONSTRAINT "ramadan_reminders_plan_id_ramadan_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."ramadan_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ramadan_reminders" ADD CONSTRAINT "ramadan_reminders_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "glucose_logs_user_logged_idx" ON "glucose_logs" USING btree ("user_id","logged_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ramadan_plans_user_year_idx" ON "ramadan_plans" USING btree ("user_id","year");--> statement-breakpoint
CREATE INDEX "ramadan_reminders_user_plan_idx" ON "ramadan_reminders" USING btree ("user_id","plan_id");--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_ramadan_plan_id_ramadan_plans_id_fk" FOREIGN KEY ("ramadan_plan_id") REFERENCES "public"."ramadan_plans"("id") ON DELETE cascade ON UPDATE no action;