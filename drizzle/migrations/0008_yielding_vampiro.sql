CREATE TYPE "public"."catalog_verification_status" AS ENUM('imported_unverified', 'candidate_match', 'manually_verified', 'unresolved', 'rejected');--> statement-breakpoint
CREATE TABLE "pakistan_medicine_brands" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"brand_name" varchar(500) NOT NULL,
	"normalized_name" varchar(500) NOT NULL,
	"manufacturer" varchar(500),
	"company_id" integer,
	"source_brand_id" integer NOT NULL,
	"data_source" varchar(64) DEFAULT 'pharmapedia' NOT NULL,
	"verification_status" "catalog_verification_status" DEFAULT 'imported_unverified' NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pakistan_medicine_ingredients" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(500) NOT NULL,
	"normalized_name" varchar(500) NOT NULL,
	"rxnorm_cui" varchar(50),
	"source_code" integer,
	"overview" text,
	"verification_status" "catalog_verification_status" DEFAULT 'imported_unverified' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pakistan_medicine_products" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"brand_id" varchar(64) NOT NULL,
	"product_name" varchar(500) NOT NULL,
	"form" varchar(100),
	"strength" varchar(255),
	"packing" varchar(255),
	"trade_price" varchar(50),
	"retail_price" varchar(50),
	"category" varchar(100),
	"source_product_id" integer NOT NULL,
	"verification_status" "catalog_verification_status" DEFAULT 'imported_unverified' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pakistan_product_ingredients" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"product_id" varchar(64) NOT NULL,
	"ingredient_id" varchar(64),
	"ingredient_name" varchar(500) NOT NULL,
	"strength" varchar(255),
	"sequence" integer DEFAULT 1 NOT NULL,
	"verification_status" "catalog_verification_status" DEFAULT 'imported_unverified' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "pakistan_medicine_products" ADD CONSTRAINT "pakistan_medicine_products_brand_id_pakistan_medicine_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."pakistan_medicine_brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pakistan_product_ingredients" ADD CONSTRAINT "pakistan_product_ingredients_product_id_pakistan_medicine_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pakistan_medicine_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pakistan_product_ingredients" ADD CONSTRAINT "pakistan_product_ingredients_ingredient_id_pakistan_medicine_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."pakistan_medicine_ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pk_brands_norm_name_idx" ON "pakistan_medicine_brands" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "pk_brands_source_id_idx" ON "pakistan_medicine_brands" USING btree ("source_brand_id");--> statement-breakpoint
CREATE INDEX "pk_brands_manufacturer_idx" ON "pakistan_medicine_brands" USING btree ("manufacturer");--> statement-breakpoint
CREATE INDEX "pk_ingr_norm_name_idx" ON "pakistan_medicine_ingredients" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "pk_ingr_source_code_idx" ON "pakistan_medicine_ingredients" USING btree ("source_code");--> statement-breakpoint
CREATE INDEX "pk_prod_brand_id_idx" ON "pakistan_medicine_products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "pk_prod_form_idx" ON "pakistan_medicine_products" USING btree ("form");--> statement-breakpoint
CREATE INDEX "pk_prod_strength_idx" ON "pakistan_medicine_products" USING btree ("strength");--> statement-breakpoint
CREATE INDEX "pk_prod_source_id_idx" ON "pakistan_medicine_products" USING btree ("source_product_id");--> statement-breakpoint
CREATE INDEX "pk_prod_ingr_prod_id_idx" ON "pakistan_product_ingredients" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "pk_prod_ingr_ingr_id_idx" ON "pakistan_product_ingredients" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "pk_prod_ingr_name_idx" ON "pakistan_product_ingredients" USING btree ("ingredient_name");