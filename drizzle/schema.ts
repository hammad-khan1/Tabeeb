import {
  pgTable, text, timestamp, uuid, varchar, integer, boolean, jsonb,
  pgEnum, vector, index, doublePrecision,
} from 'drizzle-orm/pg-core';

export const documentTypeEnum = pgEnum('document_type', [
  'prescription', 'lab_report', 'discharge_summary', 'imaging_report',
  'consultation_note', 'voice_entry', 'other',
]);

export const extractionStatusEnum = pgEnum('extraction_status', [
  'pending', 'processing', 'needs_review', 'confirmed', 'failed',
]);

export const languageEnum = pgEnum('language', ['en', 'ur', 'mixed']);

export const interactionSeverityEnum = pgEnum('interaction_severity', [
  'info', 'mild', 'moderate', 'severe', 'contraindicated',
]);

export const users = pgTable('users', {
  id: varchar('id', { length: 255 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  preferredLanguage: languageEnum('preferred_language').default('en'),
  knownAllergies: jsonb('known_allergies').$type<string[]>().default([]),
  knownConditions: jsonb('known_conditions').$type<string[]>().default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: varchar('user_id', { length: 255 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 500 }).notNull(),
  documentType: documentTypeEnum('document_type').notNull(),
  hospital: varchar('hospital', { length: 500 }),
  doctorName: varchar('doctor_name', { length: 255 }),
  documentDate: timestamp('document_date'),
  language: languageEnum('language').default('mixed'),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  fileSize: integer('file_size').notNull(),
  storagePath: varchar('storage_path', { length: 1000 }).notNull(),
  extractionStatus: extractionStatusEnum('extraction_status').default('pending'),
  /** Set when processing begins; lets a sweeper find runs killed mid-flight. */
  processingStartedAt: timestamp('processing_started_at'),
  rawExtractedText: text('raw_extracted_text'),
  summary: text('summary'),
  structuredData: jsonb('structured_data'),
  extractionConfidence: integer('extraction_confidence'),
  extractionNotes: text('extraction_notes'),
  isHandwritten: boolean('is_handwritten').default(false),
  isScannedPdf: boolean('is_scanned_pdf').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('documents_user_id_idx').on(table.userId),
  index('documents_type_idx').on(table.documentType),
  index('documents_date_idx').on(table.documentDate),
  index('documents_hospital_idx').on(table.hospital),
  index('documents_status_idx').on(table.extractionStatus),
]);

export const documentChunks = pgTable('document_chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 255 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1024 }),
  tokenCount: integer('token_count').notNull(),
  section: varchar('section', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('chunks_document_id_idx').on(table.documentId),
  index('chunks_user_id_idx').on(table.userId),
]);

export const medications = pgTable('medications', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 255 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 500 }).notNull(),
  genericName: varchar('generic_name', { length: 500 }),
  dosage: varchar('dosage', { length: 255 }),
  frequency: varchar('frequency', { length: 255 }),
  duration: varchar('duration', { length: 255 }),
  route: varchar('route', { length: 100 }),
  rxnormId: varchar('rxnorm_id', { length: 50 }),
  isActive: boolean('is_active').default(true),
  prescribedDate: timestamp('prescribed_date'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('medications_user_id_idx').on(table.userId),
  index('medications_document_id_idx').on(table.documentId),
]);

export const diagnoses = pgTable('diagnoses', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 255 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  condition: varchar('condition', { length: 500 }).notNull(),
  icd10Code: varchar('icd10_code', { length: 50 }),
  severity: varchar('severity', { length: 100 }),
  notes: text('notes'),
  diagnosedDate: timestamp('diagnosed_date'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('diagnoses_user_id_idx').on(table.userId),
]);

export const labResults = pgTable('lab_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 255 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  testName: varchar('test_name', { length: 500 }).notNull(),
  /** Normalized analyte key ("hba1c") used for grouping; testName keeps the verbatim reading. */
  canonicalTestName: varchar('canonical_test_name', { length: 200 }),
  /** Value converted into the canonical unit for this analyte, when a conversion is known. */
  canonicalValue: doublePrecision('canonical_value'),
  canonicalUnit: varchar('canonical_unit', { length: 50 }),
  value: varchar('value', { length: 100 }).notNull(),
  numericValue: doublePrecision('numeric_value'),
  unit: varchar('unit', { length: 100 }),
  referenceRange: varchar('reference_range', { length: 255 }),
  isAbnormal: boolean('is_abnormal').default(false),
  testDate: timestamp('test_date').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('lab_results_user_test_idx').on(table.userId, table.testName),
  index('lab_results_user_canonical_idx').on(table.userId, table.canonicalTestName),
  index('lab_results_date_idx').on(table.testDate),
]);

export const allergies = pgTable('allergies', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  userId: varchar('user_id', { length: 255 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  allergen: varchar('allergen', { length: 500 }).notNull(),
  allergyType: varchar('allergy_type', { length: 100 }),
  severity: varchar('severity', { length: 100 }),
  reaction: text('reaction'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('allergies_user_id_idx').on(table.userId),
]);

export const interactionChecks = pgTable('interaction_checks', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: varchar('user_id', { length: 255 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  queryText: text('query_text').notNull(),
  itemsChecked: jsonb('items_checked').$type<string[]>().notNull(),
  results: jsonb('results').notNull(),
  severity: interactionSeverityEnum('severity').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('interaction_checks_user_idx').on(table.userId),
]);

export const healthInsights = pgTable('health_insights', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: varchar('user_id', { length: 255 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 500 }).notNull(),
  digest: text('digest').notNull(),
  documentIdsReviewed: jsonb('document_ids_reviewed').$type<string[]>().notNull(),
  findings: jsonb('findings').notNull(),
  priority: varchar('priority', { length: 50 }).default('normal'),
  generatedAt: timestamp('generated_at').defaultNow(),
}, (table) => [
  index('health_insights_user_idx').on(table.userId),
]);

export const shareLinks = pgTable('share_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: varchar('user_id', { length: 255 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 255 }).notNull().unique(),
  title: varchar('title', { length: 500 }),
  documentIds: jsonb('document_ids').$type<string[]>().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  isActive: boolean('is_active').default(true),
  viewCount: integer('view_count').default(0),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('share_links_user_idx').on(table.userId),
]);

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: varchar('user_id', { length: 255 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull(),
  role: varchar('role', { length: 20 }).notNull(),
  content: text('content').notNull(),
  sources: jsonb('sources').$type<{ documentId: string; documentTitle: string; documentType: string; section?: string; relevanceScore: number }[]>(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('chat_messages_user_conv_idx').on(table.userId, table.conversationId),
  index('chat_messages_created_idx').on(table.createdAt),
]);

export const imagingFindings = pgTable('imaging_findings', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 255 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  bodyPart: varchar('body_part', { length: 200 }).notNull(),
  modality: varchar('modality', { length: 100 }),
  finding: text('finding').notNull(),
  location: varchar('location', { length: 300 }),
  severity: varchar('severity', { length: 100 }),
  description: text('description'),
  aiConfidence: integer('ai_confidence'),
  urgencyLevel: varchar('urgency_level', { length: 50 }),
  validationNotes: text('validation_notes'),
  validated: boolean('validated').default(false),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('imaging_findings_user_idx').on(table.userId),
  index('imaging_findings_doc_idx').on(table.documentId),
]);
