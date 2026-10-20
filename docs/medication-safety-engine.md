# Medication Safety & Reconciliation Engine

## Repository audit and integration

The existing application uses Next.js 16.3.3, React 19, Clerk, Drizzle/PostgreSQL,
private source-file routes, Groq extraction, RxNav terminology, and Vitest. Existing
medication rows were per-document prescriptions with an `isActive` boolean; source
reprocessing deleted their IDs, and raw model identifiers could be trusted as drug
identity. There was no patient correction history or persistent safety review.

The medication branch initially lacked Doctor-Ready Briefing commits `680c01e` and
`8e9897a`. After explicit authorization, the unfinished medication work was backed
up under `/private/tmp/tabeeb-medication-preserve-bmbxj2e_` and checkpointed in
`0e3ac89`. The local merge `c0a92ec` brought both briefing commits into
`feature/medication-safety-engine`. Navigation conflicts in sidebar, mobile nav and
top bar were resolved by retaining both features. Neither source branch nor `main`
was changed. No push, PR, or deployment is part of this work.

## Architecture and data flow

1. Existing upload/processing services extract structured data using the extended
   Zod schema. Source names, quoted instructions, formulation, dose, strength,
   dates, prescriber and uncertainty remain separate facts.
2. `medications/observations.ts` verifies excerpts against extracted text, accepts
   explicit page markers, preserves approximate date text, and computes source
   fingerprints/keys. `normalization.ts` accepts one exact verified RxNorm match.
3. Source processing prepares external extraction, normalization, embeddings and
   summary work before the owner-locked database transaction. Medication rows
   are synchronized with stable IDs. Replaced source observations are archived;
   their absence never becomes clinical discontinuation. Low-confidence retries
   retain established allergy, diagnosis and laboratory rows pending review.
4. `reconciliation.ts`, `safety.ts` and `interaction-provider.ts` implement the
   shared deterministic domain rules. Findings identify their medications,
   source evidence, uncertainty, and knowledge provider when applicable.
5. `repository.ts` preserves source-update history, patient corrections, reviews,
   and retired findings. A source revision prevents stale evaluations from being
   presented as current. Canonical JSON comparison preserves review state across
   PostgreSQL JSONB round trips.
6. `workspace.ts` serves the dashboard and audit timeline. Concurrent dashboard
   requests are coalesced per owner only while running; no medical response is
   stored in a shared HTTP cache.
7. The briefing evaluates the same domain rules on its selected document scope
   and overlays matching saved reviews without overwriting the full registry's
   evaluation. PDF output uses the existing renderer, with continuation headers
   fixed and oversized table cells split across pages without dropping text.
   Unknown clinical dates remain unknown rather than becoming upload dates.

The six statuses are confirmed current, prescribed/unconfirmed, historical,
explicitly discontinued, changed/replaced, and unknown. Patient status and
corrections are separately attributed. Newer prescriptions never automatically
supersede earlier ones.

## Database

`0007_medication_safety_engine.sql` extends the existing `medications` table with
observation JSON, source identity/activity, patient status/corrections and
timestamps. It adds `medication_findings` and `medication_audit`, owner indexes,
idempotent source-key indexes and a composite document/owner foreign key.
Existing legacy rows are adapted conservatively as unknown/unverified until
their source is reprocessed.

All migrations through 0007 were executed only in a newly initialized, independently
verified local PostgreSQL cluster:

- Host: `127.0.0.1:55439`
- Database: `tabeeb_test_medication_engine`
- Owner: `tabeeb_test_owner`
- Data directory: `/private/tmp/tabeeb-medication-db.ls3iaj/data`

The application's configured database was not migrated. The test harness no longer
loads `.env.local`; database tests require `TABEEB_RUN_DB_TESTS=1` and a separate
local `TABEEB_TEST_DATABASE_URL` with a `tabeeb_test_*` database name.

## Frontend and API

`/medications` provides status counts, search, pagination, original evidence,
patient corrections, review notes, a medication timeline, and prescription
comparison. English/Urdu labels follow the existing locale provider, with theme
tokens and responsive layouts. `/briefing` retains its original source viewer,
doctor attribution, sharing and PDF reporting, and now shows medication use
status, corrections, coverage and evidence-backed findings.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/medications` | Paginated registry, status counts and coverage |
| GET | `/api/medications/[id]` | Original observation, findings and audit |
| POST | `/api/medications/[id]/confirmation` | Patient status/corrections with a note |
| GET | `/api/medications/findings` | Category/review filters; optional retired history |
| POST | `/api/medications/findings/[id]/review` | Review; dismissal/resolution requires a reason |
| GET | `/api/medications/timeline` | Medication/current/historical filters |
| GET | `/api/medications/compare` | Two owned source documents |

## Clinical coverage and limitations

- Exact repeated source entries and identical full-source imports are detected
  conservatively. Equal medication names in independent prescriptions alone do
  not establish duplicate imports.
- Ingredient duplication uses verified ingredient identifiers. Exact recorded
  allergy matches and verified ingredient relationships are supported.
- Therapeutic duplication and allergy cross-reactivity remain unsupported in
  the new engine without validated relationship data.
- **Drug–drug interaction screening is unavailable by default.** The modular
  provider interface is implemented and tested with synthetic validated responses,
  failures and partial coverage; no licensed live DDI provider is configured.
  RxNorm identity is not an interaction database. See
  [provider research](medication-interaction-providers.md).
- Ambiguous/OCR-corrupted names and unmatched Pakistani brands remain unresolved.
  Patient name corrections invalidate the original verified identity for current
  screening. There is no invented brand mapping or fuzzy clinical equivalence.
- Reconciliation compares original documented values; patient edits remain
  separate. Missing information is a documentation issue, not a danger rating.
- Source ingestion accepts at most 200 medications per document. Registry
  snapshots are bounded to 2,000 rows per section, evaluation/timeline to 500
  records, findings to 2,000, and optional interaction lookups to 40 unique pairs.
  Provider result expansion is also capped at 2,000 findings.
  Partial coverage is displayed; it never means remaining records are cleared.
- Page numbers are available only when extraction contains explicit markers.
  Approximate dates are not assigned an invented day.
- The existing PDF renderer uses standard ASCII fonts. English layout and
  pagination are covered by coordinate-based tests; Urdu text shaping/font
  embedding is not implemented. Original documents and browser evidence remain
  available for source verification.
- Real OCR/model APIs, real patient documents, and live paid interaction APIs
  were not used for verification. Synthetic pipeline tests mock external services.

## Privacy and sharing

New APIs authenticate server-side, derive ownership from Clerk, validate UUIDs
and payloads, and return private/no-store JSON for successes and errors. Mutations
and document comparisons recheck ownership. Corrections cannot replace original
source evidence. Sensitive SQL or source text is not logged by the new routes.

Briefing shares enforce ownership, document scope, expiration, revocation and
date range. Restricted sections cannot leak through the new safety payload,
free-text summaries, questions, plans or citations. Whole original documents
are withheld when only selected sections are shared because those files cannot
enforce section redaction. Full-section shares retain the secure source viewer.
Restricted shares also withhold instruction/correction and allergy-reaction
narratives, source titles, doctor notes, and excluded clinician attribution.

## Verification commands

Executed during implementation:

```sh
npm run lint
npm run typecheck
npm run test:unit
npm test
TABEEB_RUN_DB_TESTS=1 \
TABEEB_TEST_DATABASE_URL=postgres://tabeeb_test_owner@127.0.0.1:55439/tabeeb_test_medication_engine \
npm test -- --reporter=default --reporter=json --outputFile=/private/tmp/tabeeb-medication-final-tests.json
DATABASE_URL=postgres://tabeeb_test_owner@127.0.0.1:55439/tabeeb_test_medication_engine \
node drizzle/migrate.mjs
npm run build
NEXT_PUBLIC_APP_URL=http://localhost:3001 npm run build -- --webpack
git diff --check
```

The default Turbopack build encountered environment restrictions fetching Google
Fonts and binding its internal worker port. The supported Webpack production build
is used for verification without changing the application's build script.

Coverage includes real PostgreSQL tenant boundaries and foreign keys, idempotent
ingestion, review persistence, stale findings, corrections, source deletion,
comparison, briefing/PDF integration, expired/revoked/scoped shares, unauthorized
requests, frontend forms/filtering/pagination, normalization/provider failures,
and long PDF table rows. External authentication/model calls are mocked in tests;
authentication enforcement itself remains enabled in the application.

Final lint and typecheck passed. The complete suite passed **457 tests in 40 files,
with zero failures or skipped tests**, exit code 0. It includes six pipeline tests
against the isolated database and seven section-permission regressions.
