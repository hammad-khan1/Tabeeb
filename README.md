# Tabeeb 🩺

**Tabeeb** ("physician" in Urdu) is an AI-powered personal health companion that turns scattered medical records — prescriptions, lab reports, discharge summaries, imaging reports, consultation notes, and voice notes — into a single, intelligent, searchable health history. It reads uploaded documents (English, Urdu, or mixed), builds a structured and vector-searchable "health memory," answers context-aware questions about a user's own history via RAG chat, flags drug/allergy interactions, tracks lab trends over time, and generates periodic health insight digests.

Built with **Next.js 16 (App Router)**, **TypeScript**, **Drizzle ORM + PostgreSQL/pgvector**, **Clerk** authentication, and **Groq**-hosted LLMs for extraction, vision OCR, transcription, and chat.

> ⚠️ This is a student/portfolio project, not a certified medical device. It does not provide medical advice and should not be used for real clinical decision-making.

---

## Table of Contents

- [Core Features](#core-features)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [Setup & Installation](#setup--installation)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [File-by-File Reference](#file-by-file-reference)
- [Notes on Repo Housekeeping Files](#notes-on-repo-housekeeping-files)

---

## Core Features

- **Document ingestion** — upload PDFs, images (JPEG/PNG), or DOCX files. Text is extracted via native parsing or vision-model OCR (with handwriting detection), then an LLM extracts structured medical entities (medications, diagnoses, labs, allergies, imaging findings).
- **Reconciliation & safety net** — extracted data is cross-checked against an independent medical NER pass and RxNorm-based drug-name normalization before being trusted; low-confidence or unverified findings are surfaced for user review rather than silently inserted.
- **Health memory (RAG chat)** — every document is chunked and embedded (multilingual E5, via Pinecone's embedding API) into pgvector; a chat endpoint retrieves relevant chunks plus the user's active medication/allergy/condition profile to answer questions with cited sources.
- **Interaction checking** — checks medications/allergens against each other and against RxNav's drug-interaction API, storing severity-graded results.
- **Lab trend analysis** — parses lab results over time, detects direction (rising/falling/stable/fluctuating) and anomalies relative to reference ranges.
- **Health insights digest** — periodically reviews a user's documents and generates a prioritized digest of findings.
- **Voice entries** — record a voice note, transcribed (Whisper via Groq) and structured into a document-like entry.
- **Shareable history** — generate expiring, read-only share links summarizing a user's medical history (e.g., for a new doctor).
- **Radiology validation** — imaging findings extracted from scans are checked against a curated list of urgent findings and assigned an urgency level.
- **Bilingual UI** — English and Urdu (Noto Nastaliq Urdu font) support baked into fonts/layout and language-aware summarization.

## Architecture Overview

```
Upload (PDF/Image/DOCX/Voice)
        │
        ▼
 Text Extractors  ──────────────►  pdf-extractor / image-extractor (+OCR) / docx-extractor / voice transcriber
        │
        ▼
 LLM Structured Extraction (Groq) ──► extraction-schema (Zod validation/coercion)
        │
        ▼
 Reconciliation ──► medical-ner (independent NER) + drug-normalizer (RxNav) cross-check
        │
        ▼
 Persistence (Postgres via Drizzle) ──► documents, medications, diagnoses, labResults, allergies, imagingFindings
        │
        ├─► Chunking + Embeddings (Pinecone embed API) ──► documentChunks (pgvector)
        │
        ├─► Summarizer (patient-facing plain-language summary)
        │
        └─► Radiology validator (urgency scoring, for imaging documents)

Downstream features read from the same tables:
  • RAG Chat        (retriever → prompt-builder → answer-streamer)
  • Interactions     (checker + rxnav-client)
  • Trends           (lab-parser + analyzer)
  • Insights         (digest-generator)
  • History sharing  (summarizer + share links)
```

All authenticated pages and API routes run behind **Clerk** middleware (`src/proxy.ts`), and every service function scopes queries by `userId` so one user's health memory never leaks into another's.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling / UI | Tailwind CSS 4, shadcn/ui, Radix UI primitives, lucide-react icons |
| Auth | Clerk (`@clerk/nextjs`) |
| Database | PostgreSQL + `pgvector`, via Drizzle ORM (`drizzle-orm`, `drizzle-kit`) |
| LLMs (chat, extraction, vision OCR, Whisper transcription) | Groq (`groq-sdk`) — models: `qwen/qwen3.8-27b` (vision), `openai/gpt-oss-120b` (primary), `openai/gpt-oss-20b` (fast), `whisper-large-v3-turbo` |
| Embeddings | Pinecone Inference API, `multilingual-e5-large` (1024-dim, asymmetric query/passage embeddings) |
| Drug data | RxNav (NLM) — RxNorm normalization + interaction lookups |
| File parsing | `pdf-parse`, `mammoth` (DOCX), `sharp` (image normalization for vision models) |
| Validation | Zod |
| Charts | Recharts |
| Testing | Vitest + jsdom |
| Data fetching (client) | SWR |

## Project Structure

```
Tabeeb/
├── AGENTS.md / CLAUDE.md      # Next.js-generated agent guidance notes (see below)
├── README.md
├── components.json            # shadcn/ui component generator config
├── drizzle.config.ts          # Drizzle Kit config (schema path, Postgres connection)
├── drizzle/
│   ├── schema.ts               # Full Postgres schema (Drizzle ORM table definitions)
│   └── migrations/             # (generated by `drizzle-kit`, not checked in initially)
├── next.config.ts
├── eslint.config.mjs
├── postcss.config.mjs
├── tsconfig.json
├── vitest.config.ts
├── public/                     # Static assets (default Next.js svgs)
└── src/
    ├── proxy.ts                 # Clerk auth middleware — protects app + API routes
    ├── app/
    │   ├── layout.tsx            # Root layout: ClerkProvider, fonts (Geist + Noto Nastaliq Urdu)
    │   ├── page.tsx               # Landing/marketing page
    │   ├── globals.css
    │   ├── sign-in/[[...sign-in]]/page.tsx
    │   ├── sign-up/[[...sign-up]]/page.tsx
    │   ├── (authenticated)/       # Route group for logged-in app shell
    │   │   ├── layout.tsx          # Authenticated shell (sidebar/top bar/mobile nav)
    │   │   ├── dashboard/page.tsx
    │   │   ├── documents/page.tsx, upload/page.tsx, [id]/page.tsx
    │   │   ├── chat/page.tsx
    │   │   ├── history/page.tsx, share/[token]/page.tsx
    │   │   ├── interactions/page.tsx
    │   │   ├── trends/page.tsx
    │   │   ├── insights/page.tsx
    │   │   └── settings/page.tsx
    │   └── api/                    # Route handlers (REST-style JSON API)
    │       ├── documents/{route.ts, [id]/route.ts, [id]/confirm-extraction/route.ts, [id]/reprocess/route.ts}
    │       ├── chat/{route.ts, history/route.ts}
    │       ├── history/{route.ts, share/route.ts}
    │       ├── insights/{route.ts, generate/route.ts}
    │       ├── interactions/check/route.ts
    │       ├── search/route.ts
    │       ├── settings/route.ts
    │       ├── trends/route.ts
    │       └── voice/transcribe/route.ts
    ├── components/
    │   ├── layout/{sidebar.tsx, top-bar.tsx, mobile-nav.tsx}
    │   └── ui/                     # shadcn/ui primitives (button, card, dialog, dropdown-menu, input, label, badge, scroll-area, select, separator, sheet, tabs, textarea, tooltip)
    ├── hooks/
    │   ├── use-chat.ts
    │   ├── use-documents.ts
    │   └── use-voice-recorder.ts
    ├── lib/
    │   ├── auth.ts                 # Clerk session helper + lazy user provisioning
    │   ├── api-error.ts            # Shared error → HTTP response mapper
    │   ├── db.ts                   # Drizzle/Postgres client (lazy singleton)
    │   ├── groq.ts                 # Groq client + model name constants
    │   ├── embeddings.ts           # Pinecone embedding client
    │   ├── storage.ts              # Local filesystem file storage
    │   └── constants.ts            # Supported file types, size limits, labels
    ├── services/
    │   ├── document-processor.ts   # Orchestrates the full ingestion pipeline
    │   ├── extraction-schema.ts    # Zod schema/coercion for raw LLM extraction JSON
    │   ├── summarizer.ts           # Patient-facing document summaries
    │   ├── history/{summarizer.ts, share.ts}
    │   ├── insights/digest-generator.ts
    │   ├── interactions/{checker.ts, rxnav-client.ts}
    │   ├── nlp/{medical-ner.ts, drug-normalizer.ts, reconciler.ts} (+ .test.ts)
    │   ├── radiology/validator.ts
    │   ├── rag/{retriever.ts, prompt-builder.ts, answer-streamer.ts}
    │   ├── text-extractors/{pdf-extractor.ts, image-extractor.ts, image-normalizer.ts, docx-extractor.ts, index.ts}
    │   ├── trends/{analyzer.ts, lab-parser.ts} (+ .test.ts)
    │   └── voice/{transcriber.ts, structurer.ts}
    └── types/
        ├── index.ts                 # Barrel re-export
        ├── document.ts
        ├── medical.ts
        └── chat.ts
```

## Data Model

Defined in `drizzle/schema.ts` (PostgreSQL, via Drizzle ORM). Key tables:

| Table | Purpose |
|---|---|
| `users` | Clerk-linked user profile: preferred language, known allergies/conditions |
| `documents` | Each uploaded/recorded document, its extraction status, raw text, structured JSON, summary, and OCR/handwriting flags |
| `document_chunks` | Chunked document text + 1024-dim vector embeddings for RAG retrieval |
| `medications` | Structured medication entries linked to a document |
| `diagnoses` | Structured diagnoses (with ICD-10 where identifiable) |
| `lab_results` | Structured lab test results with numeric value + reference range, used for trend analysis |
| `allergies` | Structured allergy entries |
| `imaging_findings` | Radiology findings with urgency level and validation notes |
| `interaction_checks` | Logged drug/allergy interaction check results |
| `health_insights` | Generated insight digests |
| `share_links` | Expiring tokens for shareable read-only history views |
| `chat_messages` | RAG chat conversation history, with cited source documents |

Enums: `document_type`, `extraction_status`, `language` (`en`/`ur`/`mixed`), `interaction_severity`.

## Setup & Installation

**Prerequisites:** Node.js, a PostgreSQL database with the `pgvector` extension enabled, and API keys for Clerk, Groq, and Pinecone.

```bash
git clone https://github.com/hammad-khan1/Tabeeb.git
cd Tabeeb
npm install

# create .env.local with the variables listed below

# push the Drizzle schema to your database
npx drizzle-kit push

# run the dev server
npm run dev
```

Open http://localhost:3000.

## Environment Variables

Create a `.env.local` file with:

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (`src/lib/db.ts`, `drizzle.config.ts`) |
| `GROQ_API_KEY` | Groq API access for extraction, vision OCR, chat, and Whisper transcription (`src/lib/groq.ts`) |
| `PINECONE_API_KEY` | Pinecone embedding API for document/query embeddings (`src/lib/embeddings.ts`) |
| `HF_API_KEY` | *(optional)* Hugging Face Inference API for the `d4data/biomedical-ner-all` NER backend (`src/services/nlp/medical-ner.ts`); a deterministic pattern-based NER still runs without it |
| `NEXT_PUBLIC_APP_URL` | Public base URL, used when constructing share links |
| Clerk keys (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, etc.) | Authentication via `@clerk/nextjs` — standard Clerk Next.js setup |

## Available Scripts

```bash
npm run dev          # start the Next.js dev server
npm run build        # production build
npm run start        # start the production server
npm run lint         # ESLint
npm run test         # run the Vitest suite once
npm run test:watch   # Vitest in watch mode
```

Tests currently cover: `document-processor` reconciliation logic, `medical-ner`, `reconciler`, `trends/analyzer`, and `trends/lab-parser`.

## File-by-File Reference

### Root config
- **`package.json`** — dependencies/scripts (Next 16, React 19, Drizzle, Groq SDK, Zod, Vitest, etc.)
- **`drizzle.config.ts`** — points Drizzle Kit at `drizzle/schema.ts` and the Postgres `DATABASE_URL`
- **`next.config.ts`**, **`eslint.config.mjs`**, **`postcss.config.mjs`**, **`tsconfig.json`**, **`vitest.config.ts`**, **`components.json`** — standard Next.js/Tailwind/shadcn/TypeScript/test tooling config

### `drizzle/schema.ts`
Single source of truth for the entire relational + vector schema (see [Data Model](#data-model)).

### `src/proxy.ts`
Clerk `clerkMiddleware` — protects `/dashboard`, `/documents`, `/chat`, `/history`, `/interactions`, `/trends`, `/insights`, `/settings` and their sub-routes; unauthenticated requests are redirected to sign-in.

### `src/lib/`
- **`db.ts`** — lazily-created Drizzle/`postgres` client singleton, exposed both as `getDb()` and a proxied `db` export.
- **`auth.ts`** — `getCurrentUserId()` reads the Clerk session and auto-provisions a `users` row on first sight (`ensureUser`); throws `AuthError` (401) if unauthenticated.
- **`api-error.ts`** — `errorResponse()` turns a thrown error into a `NextResponse` JSON error, mapping `AuthError` to 401 and everything else to 500.
- **`groq.ts`** — lazy Groq client + the `MODELS` map (vision/primary/fast/whisper).
- **`embeddings.ts`** — calls Pinecone's `/embed` endpoint with `multilingual-e5-large`, batches inputs (max 96), and enforces the query/passage asymmetric embedding distinction.
- **`storage.ts`** — simple local-filesystem `FileStorage` implementation (`public/uploads/<userId>/<file>`).
- **`constants.ts`** — supported MIME types, 20MB max upload size, human-readable document type labels.
- **`utils.ts`** — `cn()` Tailwind class-merging helper (clsx + tailwind-merge).

### `src/services/` — core domain logic
- **`document-processor.ts`** — the main ingestion pipeline: extract text → detect sections → LLM structured extraction → reconciliation → chunk + embed → persist all rows → generate summary → (for imaging) validate radiology findings.
- **`extraction-schema.ts`** — Zod schemas that coerce the LLM's free-form extraction JSON into trustworthy typed data (drops placeholder strings like `"n/a"`, coerces booleans/numbers, filters malformed array entries).
- **`summarizer.ts`** — turns a validated extraction into a plain-language, patient-facing document summary, respecting the document's/user's language.
- **`text-extractors/`**
  - `pdf-extractor.ts` — extracts embedded text; if a PDF has no real text layer (a scan), renders pages to images for downstream OCR.
  - `image-extractor.ts` — vision-model OCR + radiology finding extraction for images.
  - `image-normalizer.ts` — transcodes non-vision-native formats (HEIC/TIFF/GIF), applies EXIF rotation, flattens transparency, resizes for the vision model.
  - `docx-extractor.ts` — raw text extraction from Word docs via `mammoth`.
  - `index.ts` — dispatches to the right extractor by MIME type.
- **`nlp/`**
  - `medical-ner.ts` — a second, independent entity-recognition pass (deterministic pattern matcher always on; optional Hugging Face `d4data/biomedical-ner-all` backend) used to catch entities the LLM extractor missed.
  - `drug-normalizer.ts` — matches OCR'd/misspelled drug names to canonical RxNorm concepts via RxNav's `approximateTerm`.
  - `reconciler.ts` — cross-checks LLM extraction against NER + RxNorm; auto-corrects drug spelling but only *reports* (never silently inserts) entities the LLM missed.
- **`radiology/validator.ts`** — flags imaging findings against a curated urgent-findings list and assigns an urgency level (`routine`/`follow-up`/`urgent`/`critical`).
- **`rag/`**
  - `retriever.ts` — vector-similarity search over `document_chunks` for a user's query.
  - `prompt-builder.ts` — assembles the chat prompt from retrieved chunks + the user's medication/allergy/condition profile + imaging findings.
  - `answer-streamer.ts` — streams the chat completion from Groq (temperature 0, deterministic seed).
- **`interactions/`**
  - `checker.ts` — checks a user's active medications/allergies for interactions, combining RxNav data with an LLM read; stores results with a severity grade.
  - `rxnav-client.ts` — thin client for NLM's RxNav interaction API.
- **`trends/`**
  - `lab-parser.ts` — normalizes raw LLM-extracted lab entries into typed, validated lab results.
  - `analyzer.ts` — computes trend direction (stable/rising/falling/fluctuating) and anomalies relative to reference ranges over time.
- **`voice/`**
  - `transcriber.ts` — transcribes a recorded voice note via Groq's Whisper model.
  - `structurer.ts` — turns the transcript into a structured, document-like entry (meds, symptoms, conditions, etc.).
- **`history/`**
  - `summarizer.ts` — builds an aggregate medical history summary across all of a user's documents.
  - `share.ts` — creates/validates expiring share-link tokens for read-only history sharing.
- **`insights/digest-generator.ts`** — periodically reviews a user's records and produces a prioritized `health_insights` digest.

### `src/app/` — routes
- **`layout.tsx`** — root layout: wraps the app in `ClerkProvider`, loads Geist (Latin) and Noto Nastaliq Urdu fonts.
- **`page.tsx`** — public landing page.
- **`sign-in/`, `sign-up/`** — Clerk catch-all auth pages.
- **`(authenticated)/`** — route group for the logged-in app shell (its own `layout.tsx` renders the sidebar/top bar/mobile nav) containing `dashboard`, `documents` (list, upload, detail), `chat`, `history` (+ public `share/[token]` view), `interactions`, `trends`, `insights`, and `settings` pages.
- **`api/`** — one route handler per feature area, mirroring the services above: document CRUD + confirm-extraction/reprocess actions, chat + chat history, history + history sharing, insights (list/generate), interaction checking, full-text/semantic search, settings, lab trends, and voice transcription.

### `src/components/`
- **`layout/`** — `sidebar.tsx`, `top-bar.tsx`, `mobile-nav.tsx` for the authenticated app shell.
- **`ui/`** — shadcn/ui-generated primitives (button, card, dialog, dropdown-menu, input, label, badge, scroll-area, select, separator, sheet, tabs, textarea, tooltip) used throughout the app.

### `src/hooks/`
- **`use-chat.ts`** — client-side chat state/streaming hook.
- **`use-documents.ts`** — SWR-backed document list/detail data fetching.
- **`use-voice-recorder.ts`** — browser microphone recording hook feeding the voice-entry flow.

### `src/types/`
- **`document.ts`**, **`medical.ts`**, **`chat.ts`** — shared TypeScript types for documents, medical entities, and chat messages/sources; re-exported from **`index.ts`**.

### `public/`
Default Next.js starter SVG assets (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`). Uploaded user files are written at runtime to `public/uploads/<userId>/...` by `src/lib/storage.ts` (not checked into the repo).

## Notes on Repo Housekeeping Files

- **`AGENTS.md`** / **`CLAUDE.md`** — these are auto-generated by the Next.js 16 dev server itself (not authored project documentation). `CLAUDE.md` just includes `AGENTS.md`, which tells AI coding agents to check `node_modules/next/dist/docs/` for framework-specific conventions before editing code, since this Next.js version may differ from an agent's training data. They're regenerated by `next dev` and are safe to keep committed.
- **`.tmp-probe/`** — a working/scratch directory (test images and small scripts such as `compare-passes.mts`, `make-handwritten.mjs`, `run-pipeline.mts`) apparently used to manually probe the OCR/extraction pipeline against synthetic faint, handwritten, and low-quality prescription images. It isn't part of the application build and looks like local debugging output rather than a maintained part of the codebase.