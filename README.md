# Tabeeb 🩺

**Tabeeb** ("physician" in Urdu) is an AI-powered personal health companion that turns scattered medical records — prescriptions, lab reports, discharge summaries, imaging reports, consultation notes, and voice notes — into a single, intelligent, searchable health history. It reads uploaded documents (English, Urdu, or mixed), builds a structured and vector-searchable "health memory," answers context-aware questions about a user's own history via RAG chat, flags drug/allergy interactions, tracks lab trends over time, and generates periodic health insight digests.

Built with **Next.js 16 (App Router)**, **TypeScript**, **Drizzle ORM + PostgreSQL/pgvector**, **Clerk** authentication, and **Groq**-hosted LLMs for extraction, vision OCR, transcription, and chat.

> ⚠️ This is a student/portfolio project, not a certified medical device. It does not provide medical advice and should not be used for real clinical decision-making.

---
## 🚀 Live Demo

**Try Tabeeb live:** [https://tabeeb-f20n.onrender.com/](https://tabeeb-f20n.onrender.com/)

Explore how Tabeeb transforms scattered medical records into an organized, searchable health history with AI-powered document processing, bilingual health queries, lab trend analysis, and personalized health insights.

> ⚠️ **Disclaimer:** Tabeeb is a student/portfolio project, not a certified medical device. It does not provide medical advice and should not be used for real clinical decision-making.

## Table of Contents

- [Core Features](#core-features)
- [Ramzan Mode](#ramzan-mode)
- [Mother-care](#mother-care)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [Setup & Installation](#setup--installation)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Live Demo](#-live-demo)
- [Deploying](#deploying)
- [File-by-File Reference](#file-by-file-reference)
- [Notes on Repo Housekeeping Files](#notes-on-repo-housekeeping-files)

---

## Core Features

- **Document ingestion** — upload PDFs, images (JPEG/PNG/HEIC/WebP/TIFF), DOCX or text files. Text is extracted via native parsing or vision-model OCR (with handwriting detection), then an LLM extracts structured medical entities (medications, diagnoses, labs, allergies, imaging findings).
- **Reconciliation & safety net** — extracted data is cross-checked against an independent medical NER pass and RxNorm-based drug-name normalization before being trusted; low-confidence or unverified findings are surfaced for user review rather than silently inserted.
- **Assertion detection** — before anything is written to the record, each condition and allergy is classified by how the document asserts it: stated, denied, a relative's, past history, conditional advice, or a hedge. "No history of diabetes", "family history of diabetes" and "diabetic since 2019" produce the same entity from an extractor, so without this pass a record can state the opposite of the document it came from. Findings the document does not attribute to the patient are kept out of the record and explained in the document's notes. Cues cover English, Urdu and Roman Urdu.
- **Concept linking** — conditions are matched to a curated ICD-10 catalogue (with local-language aliases) so "T2DM", "DM type II", "diabetes mellitus" and "شوگر" collapse to one concept with one code instead of reading as four diseases; labs already link to LOINC the same way, and drugs to RxNorm.
- **Urdu / Roman-Urdu NLP** — a deterministic layer underneath the rest: script detection, Urdu normalisation (diacritics, Arabic-vs-Urdu letterforms, eastern digits), phonetic keys that fold Roman-Urdu spelling variance (khansi/khaansi), and a curated local medical lexicon mapped to English clinical terms.
- **Health memory (RAG chat)** — every document is chunked and embedded (multilingual E5, via Pinecone's embedding API) into pgvector; a chat endpoint retrieves relevant chunks plus the user's active medication/allergy/condition profile to answer questions with cited sources. Before the lexical arm runs, the query is expanded into the vocabulary the documents actually use — "sugar" also searches HbA1c and glucose, an Urdu question also searches its English terms — and the fused candidates are reranked on how much of that vocabulary each chunk contains, since rank fusion alone never reads the text it ranks. The dense arm always embeds the patient's own wording.
- **Interaction checking** — compares a queried medicine against the user's own record: shared active ingredient and shared ATC therapeutic class (both from RxNorm/RxClass), plus allergy matching that also covers the drug's class, so a penicillin allergy flags amoxicillin. **Pairwise drug–drug interaction screening is not included** — NLM retired its free Drug Interaction API in January 2024 and there is no free replacement, so the app states that limitation rather than letting a model invent interactions.
- **Lab trend analysis** — parses lab results over time, detects direction (rising/falling/stable/fluctuating) and anomalies relative to reference ranges.
- **Health insights digest** — periodically reviews a user's documents and generates a prioritized digest of findings.
- **Voice entries** — record a voice note, transcribed (Whisper via Groq) and structured into a document-like entry.
- **Shareable history** — generate expiring, read-only share links summarizing a user's medical history (e.g., for a new doctor).
- **Bilingual UI** — English and Urdu (Noto Nastaliq Urdu font) support baked into fonts/layout and language-aware summarization.
- **Mother-care** — a pregnancy companion: the visit calendar, iron and tetanus tracking, Urdu danger signs that always say "go to the hospital now", family alerts and an emergency QR summary. See [Mother-care](#mother-care).
- **Ramzan Mode** — helps a person with diabetes fast more safely during Ramadan: a fasting risk check, a one-page sheet for their doctor, Sehri/Iftar reminders and Urdu "break your fast now" alerts. See [Ramzan Mode](#ramzan-mode).

## Ramzan Mode

Most people with type 2 diabetes fast in Ramadan — 78.7% for at least 15 days across
13 countries in the EPIDIAR study — many against medical advice, and severe
hypoglycaemia rises several-fold during the month. Ramzan Mode (`/ramadan`) supports the
patient and their doctor from a few weeks before Ramadan until Eid:

1. **Opt in.** The patient says whether they plan to fast, chooses a city (or shares
   their location) and confirms the dates, which are pre-filled as an estimate because
   Ramadan begins on moon sighting. They can name a family member to alert.
2. **Fasting risk check.** The IDF-DAR 2021 risk score. Items the record answers
   outright are filled from it — HbA1c, the treatment, diabetes type and duration,
   kidney function, fasting hours — each shown with where it came from (table, row,
   document, value, date) and open to correction. Everything else is asked one
   question per screen, by tap or by voice.
3. **Plan sheet for the doctor.** An expiring link to a printable one-page sheet: the
   score with a source for every point, current medicines as recorded, recent HbA1c and
   the last two weeks of logged glucose. The doctor sets the Ramzan doses; the patient
   uploads that prescription and links it to the plan.
4. **Roza-clock reminders.** Sehri and Iftar times for the patient's place (computed
   offline, Karachi method, Hanafi Asr), glucose-check prompts at mid-day, two hours
   before Iftar and two hours after, and medicine reminders from the doctor's Ramzan
   prescription. Any reminder can be switched off.
5. **Break-the-fast alerts.** Each reading — typed, spoken ("sugar baasath hai"),
   or read from a photo of the glucometer — is checked against fixed thresholds: below
   70 mg/dL, above 300 mg/dL, or symptoms. An alert fills the screen in Urdu first, with
   English below, says that breaking the fast for health is permitted, and records when
   the patient breaks the fast.

**What it will not do**

- **Change or suggest a dose.** Without the doctor's Ramzan prescription, current
  medicines are listed under "Ask your doctor to adjust these for Ramzan" and given no
  Ramzan time. Even on the doctor's plan, a dose written for the morning or afternoon is
  flagged rather than placed, because it falls inside the fast.
- **Use a model for any medical number.** The score, bands, thresholds, unit
  conversion and schedule are deterministic code with unit tests. A model only turns a
  spoken or photographed answer into a value, and the patient confirms it first.
- **Give a religious ruling.** The result is labelled as medical guidance; the decision
  to fast stays with the patient, their doctor and their scholar.

**Limits**

- Most IDF-DAR score values are deliberately left empty (`TODO(verify)` in
  `src/services/ramadan/constants.ts`) until a clinician copies them from the
  guideline's table. Until then answers are saved but **no total or band is shown**,
  and `constants.test.ts` fails on purpose.
- The Urdu alert wording and the Pakistani brand list in `drug-classes.ts` need review
  by a doctor and a pharmacist before real patients use this.
- Reminders are in-app only. `services/ramadan/notify.ts` is the hook for WhatsApp,
  SMS or web push; the default sends nothing.
- The 2027 and 2028 dates are estimates, and there is no end-of-Ramadan (Eid) summary yet.

To try it locally: `npx tsx scripts/seed-ramzan-demo.ts --with-plan` creates a demo
patient (type 2 diabetes for 12 years, on glibenclamide and metformin, HbA1c 9.2%) and
prints a link to their doctor sheet. Pass `--user <your Clerk user id>` to add the
demo records to your own account and walk through `/ramadan` signed in.

## Mother-care

Pakistan's Maternal Mortality Survey 2019 recorded 186 maternal deaths per 100,000
live births; heavy bleeding (41%) and hypertensive disorders such as pre-eclampsia
(29%) caused 70% of them, and both usually give warning signs first. Only 52% of women
had four or more antenatal visits, against WHO's recommended eight. Mother-care
(`/mother-care`, under **Special cases**) is built so that a family recognises the
danger in time and goes to the hospital.

1. **Start the pregnancy.** Enter the first day of the last period or the due date,
   or let Tabeeb read the due date (EDD) from an uploaded ultrasound report — a plain
   pattern match, confirmed by the family. Tabeeb works out the current week.
2. **Check-ups.** WHO's 8-contact schedule (by 12 weeks, then 20, 26, 30, 34, 36, 38
   and 40), each shown as done, due, upcoming or missed, with photographed visit notes
   filed under the visit. A reminder names her for whoever arranges transport:
   *"Kal Fatima ka 30 hafte ka checkup hai."*
3. **Tablets and injections.** A daily *"Goli li?"* tap for iron and folic acid with
   a running count, tetanus (TT/Td) doses due from her history, and Hb from her
   attached blood reports, flagged when it falls at each of three tests.
4. **Danger signs.** A large picture screen of eight signs in Urdu, Roman Urdu and
   English — bleeding, severe headache or blurred vision or swelling, fits, high fever,
   severe stomach pain, difficulty breathing, the baby moving much less, waters breaking
   early. Every one says *"Foran hospital jayein"*.
5. **"Mujhe yeh ho raha hai".** Tapping a sign shows the red hospital screen at once,
   alerts the family members she chose, and opens her one-page emergency summary
   (due date, blood group, Hb, BP, past complications, the sign) as a QR code for the
   emergency doctor, valid for 24 hours.
6. **Birth preparedness**, from week 34: hospital, transport at night, who goes with
   her, money set aside, a blood donor arranged in advance.
7. **After the birth**, the danger signs switch to the six postnatal weeks.

**Her record is hers.** It can live on a husband's or relative's account, so it reads
only reports attached to the pregnancy, never the rest of that account. A family member
can only start it after confirming she agreed; she chooses who gets reminders and
alerts, can remove anyone, and can delete the whole record.

**What it will not do.** It never diagnoses ("this sign can be dangerous", never "you
have pre-eclampsia"), never grades a danger sign as mild or says to wait, and never
generates its medical content: the schedule, signs and supplement guidance are fixed
text from WHO guidance, in `src/services/pregnancy/`.

**Limits**

- The Urdu content needs a doctor's review before release.
- **Audio is not recorded yet.** The play button stays hidden until the clips exist,
  recorded once by a real voice and reviewed by a doctor — never a live synthetic
  voice. Record them as `public/audio/pregnancy/<phase>-<sign>.mp3` and list each in
  `AUDIO_RECORDED` in `danger-signs.ts`: `antenatal-bleeding`,
  `antenatal-headache_vision_swelling`, `antenatal-fits`, `antenatal-high_fever`,
  `antenatal-abdominal_pain`, `antenatal-breathing`, `antenatal-reduced_movement`,
  `antenatal-waters_breaking`, `postnatal-heavy_bleeding`,
  `postnatal-headache_vision_swelling`, `postnatal-fits`, `postnatal-fever_weakness`,
  `postnatal-breathing`, `postnatal-abdominal_pain`, `postnatal-calf_pain`,
  `postnatal-foul_discharge`.
- Reminders and family alerts go through `services/notify.ts`, which sends nothing
  until an SMS or WhatsApp gateway is connected; reminders show in the app meanwhile.
- The family vault, emergency QR and child vaccination features the specification
  refers to do not exist yet; Mother-care carries its own family list and emergency
  link, and the hand-off to child vaccination is not built.

To try it: `npx tsx scripts/seed-mother-care-demo.ts [--user <your Clerk user id>]`
adds "Ayesha, 28 weeks" to an account, with three visits done, the 30-week visit on a
Monday, 21 days of iron in a row, falling Hb and her mother-in-law set to receive
alerts.

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
 Clinical context ──► assertion (negated / family / historical / hypothetical) + condition-linker (ICD-10)
        │            findings the document does not attribute to the patient stop here
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
│   └── migrations/             # checked in; run with `npm run db:migrate`
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
    │   ├── nlp/{medical-ner.ts, drug-normalizer.ts, lab-normalizer.ts, reconciler.ts,
    │   │        urdu.ts, assertion.ts, condition-linker.ts} (+ .test.ts)
    │   ├── radiology/validator.ts
    │   ├── rag/{retriever.ts, query-rewriter.ts, query-expander.ts, reranker.ts,
    │   │        prompt-builder.ts, answer-streamer.ts}
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
| `ramadan_plans` | Ramzan Mode: one plan per user per year — dates, place, intent, the risk answers with their sources, and the linked doctor's prescription |
| `glucose_logs` | Ramzan Mode: logged readings (stored in mg/dL), symptoms, the alert raised, and when the fast was broken |
| `ramadan_reminders` | Ramzan Mode: reminders the patient switched off |
| `pregnancies` | Mother-care: one per pregnancy — due date, consent, blood group, tetanus history, birth plan, status |
| `anc_contacts` | Mother-care: the eight WHO visits, when each was done, and its visit notes |
| `pregnancy_documents` | Mother-care: the reports she attached; the only documents Mother-care reads |
| `supplement_logs` | Mother-care: iron tablets taken and tetanus doses given |
| `bp_readings` | Mother-care: blood pressure readings |
| `pregnancy_caregivers` | Mother-care: family members she chose, and whether each gets reminders and alerts |
| `danger_events` | Mother-care: danger signs she reported, and how many family members were alerted |

Enums: `document_type`, `extraction_status`, `language` (`en`/`ur`/`mixed`), `interaction_severity`.

## Setup & Installation

**Prerequisites:** Node.js, a PostgreSQL database with the `pgvector` extension enabled, and API keys for Clerk, Groq, and Pinecone.

```bash
git clone https://github.com/hammad-khan1/Tabeeb.git
cd Tabeeb
npm install

# copy the template and fill it in — it documents every variable
cp .env.example .env.local

# apply migrations (creates the pgvector/pg_trgm extensions and the
# retrieval indexes; `drizzle-kit push` alone does NOT create these)
npm run db:migrate

# timestamps are stored without a time zone and read as UTC, so a local Postgres must
# run in UTC (hosted ones such as Neon already do):
#   psql -c "ALTER DATABASE <your database> SET timezone TO 'UTC';"

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
| `HF_API_KEY` | *(optional)* Hugging Face Inference API, used by the `d4data/biomedical-ner-all` NER backend (`src/services/nlp/medical-ner.ts`; a deterministic pattern-based NER still runs without it) |
| `NEXT_PUBLIC_APP_URL` | Public base URL, used when constructing share links |
| `UPLOAD_DIR` | *(optional)* Where uploaded files are stored, default `./.data/uploads`. **Must not be inside `./public`** — Next serves that tree with no authentication (`src/lib/env.ts`) |
| `GROQ_VISION_MODEL` / `GROQ_PRIMARY_MODEL` / `GROQ_FAST_MODEL` / `GROQ_WHISPER_MODEL` | *(optional)* Pin a model id without a code change |
| Clerk keys (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, etc.) | Authentication via `@clerk/nextjs` — standard Clerk Next.js setup |

## Available Scripts

```bash
npm run dev          # start the Next.js dev server
npm run build        # production build
npm run start        # start the production server
npm run lint         # ESLint
npm run typecheck    # next typegen && tsc --noEmit
npm run test         # run the Vitest suite once
npm run test:watch   # Vitest in watch mode

npm run db:generate  # generate a migration from drizzle/schema.ts
npm run db:migrate   # apply pending migrations
npm run db:studio    # Drizzle Studio

npx tsx scripts/seed-ramzan-demo.ts [--with-plan] [--user <clerk id>]   # Ramzan Mode demo patient
npx tsx scripts/seed-mother-care-demo.ts [--user <clerk id>]             # Mother-care demo (Ayesha, 28 weeks)
```

Migrations are checked in under `drizzle/migrations`. `0000_init.sql` creates the
`vector` and `pg_trgm` extensions and, at the end, the four retrieval indexes
Drizzle's schema DSL cannot express (HNSW over embeddings, a `tsvector` GIN index,
two trigram indexes); `0001` rebuilds the text index with the `english`
configuration; `0002` adds `assertion_status` to `diagnoses` and `allergies`. If you
regenerate migrations, carry those statements forward.

Tests (179) cover the clinical value and reference-range parsing, the lab analyte
catalogue, medical NER, reconciliation, drug/allergy interaction logic, storage path handling, request validation, rate limiting,
model-failure classification, and share-link scoping.


## Deploying

The app runs on any Node host. Two things must be settled before a real deploy:

**Storage.** Local disk does not survive on a serverless platform — those filesystems
are recreated per invocation, so uploaded documents would vanish. Set the `S3_*`
variables to use object storage instead; any S3-compatible service works (Cloudflare
R2, AWS S3, Backblaze B2, MinIO). R2 is the usual choice at small scale: 10GB free and
no egress charges, which matters when the payload is scans people re-open. A
half-configured bucket raises at startup rather than silently falling back to disk and
losing everything on the first deploy.

**Instance count.** Rate limiting and the chat response cache are in-process, so across
several instances each enforces its own limits and the cache is often cold. Both are
correct on a single instance, and the limiter's `consume()` is a drop-in replacement
when Redis becomes worth it. Background document processing uses `after()`, which
survives the response returning but not an instance dying mid-run; the stalled-job
sweeper recovers those on the next request.

At small scale a single instance plus Neon plus R2 is a complete, correct deployment.
Nothing in the code needs to change to scale past that — only the two pieces above.

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
  - `lab-normalizer.ts` — canonicalises lab names, values and units against a curated analyte catalogue carrying LOINC codes.
  - `urdu.ts` — script detection, Urdu normalisation, Roman-Urdu phonetic keys, and a curated Urdu/Roman-Urdu medical lexicon mapped to English clinical terms. Shared by the assertion detector, the condition linker and query expansion.
  - `assertion.ts` — ConText/NegEx-style classifier deciding whether the document asserts a finding of the patient (`present`), denies it (`absent`), attributes it to a relative (`family`), places it in the past (`historical`), conditions it (`hypothetical`) or hedges it (`uncertain`). Cue lexicons in English, Urdu and Roman Urdu, with scope bounded by clause-termination cues. A term the text does not literally contain defaults to `present`, so rewording never deletes a real diagnosis.
  - `condition-linker.ts` — curated ICD-10 catalogue with English abbreviations and local-language aliases; resolves a written condition to one concept, and only codes confident matches (a partial match is reported but never written as a code).
  - `reconciler.ts` — cross-checks LLM extraction against NER + RxNorm, then runs assertion detection and concept linking over conditions and allergies; auto-corrects drug spelling but only *reports* (never silently inserts) entities the LLM missed, and explains every finding it holds back.
- **`radiology/validator.ts`** — flags imaging findings against a curated urgent-findings list and assigns an urgency level (`routine`/`follow-up`/`urgent`/`critical`).
- **`rag/`**
  - `retriever.ts` — hybrid dense + lexical search over `document_chunks`, fused with reciprocal rank fusion and scored against term coverage, recency and section match.
  - `query-expander.ts` — expands the query into clinical vocabulary (shorthand, synonyms, Urdu→English, catalogue condition names) for the lexical arm only; never replaces the patient's own words and never throws.
  - `reranker.ts` — term-coverage scoring of each candidate chunk against the expanded query, weighted towards rare terms and exact numbers. The cheap stand-in for a cross-encoder, which is not an option on a request that must answer in seconds.
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

## Decisions

`docs/decisions.md` records what was tried and rejected — X-ray interpretation, limb
fracture detection, drug–drug interaction screening — with the measurements behind
each. Read it before proposing any of them again.
