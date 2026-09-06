# Decisions

Things that were tried and rejected, and things the app deliberately does not do.

Each of these is a question that comes up again — from a new contributor, from a
stakeholder, or from whoever is reading this in six months. Without the measurements,
the obvious next step is to try them again.

---

## No X-ray image analysis

**Decision:** Tabeeb reads text off images. It does not interpret radiographs.

The specification's vision requirement is OCR: *"extract text from handwritten
prescriptions, in addition to standard printed documents such as lab reports"*. Reading
films for disease was built, then removed as out of scope.

Imaging **reports** are still a document type — a radiologist's written report is a
document a patient holds, and the vault stores it like any other.

### Why the general vision model cannot do it

The original implementation prompted a general-purpose vision LLM as *"a
board-certified radiologist AI performing clinical-grade analysis"* and stored whatever
it returned, marked `validated: true`. A general VLM cannot detect a pneumothorax. It
produced fluent, structured, unfounded findings — the same failure as a model asked to
list drug interactions with no interaction data.

### What was measured, if it is ever reconsidered

A purpose-trained classifier was integrated (torchxrayvision `densenet121-res224-all`,
exported to ONNX, ~40ms in-process). It worked, and three things made it unsuitable
anyway:

- **It reads chests only.** The uploaded X-rays were feet and ankles. A chest model
  scores chest pathologies on whatever pixels it receives — run unguarded it reported
  *pneumonia 73%* on a photograph of a leg.
- **Distribution guards do not separate "unreadable" from "abnormal".** A guard tuned
  on a normal chest film suppressed a genuine miliary-TB result, because an abnormal
  chest elevates many pathologies at once and that looks identical to noise.
- **Photographed films are legitimate input, badly delivered.** qXR, a cleared product,
  was validated on smartphone photos of films against digital originals (JMIR Formative
  Research 2024, n=1,278) with no statistically significant difference. But every X-ray
  reaching this app came through WhatsApp at 720px on the long edge — roughly a tenth
  of what the phone captured.

## No limb fracture detection

**Decision:** rejected. The available free model is not usable.

`prithivMLmods/Bone-Fracture-Detection` publishes 83% accuracy and 0.79 recall on 8,863
held-out samples, which looked workable. Run against the images this app actually
receives:

| image | "Fractured" |
| --- | --- |
| foot X-ray | 0.909 |
| leg X-ray with metal implant | 0.229 |
| **chest X-ray (miliary TB)** | **0.980** |
| **photograph of a prescription** | **0.822** |

It calls a chest film 98% fractured and a picture of a sheet of paper 82% fractured. The
published accuracy is on its own split; outside that distribution the output is
near-arbitrary and biased toward the positive class. A patient shown *"possible
fracture, 91%"* would be told the same about their prescription.

Real fracture detection needs a cleared product — Gleamer BoneView is built for it.

## No drug–drug interaction screening

**Decision:** the app states this limitation rather than implying coverage.

NLM retired its free Drug Interaction API on 2 January 2024.
`/REST/interaction/interaction.json` and `/interaction/list.json` both return 404. The
original code called them, swallowed the errors, and still asked the model to produce a
list of interactions — so patients saw invented interactions labelled as NIH data.

What RxNorm still answers authoritatively is drug *identity*, so the checker derives
what it can verify: duplicate active ingredient, shared ATC therapeutic class, and
allergy matches including class-level cover (a penicillin allergy flags amoxicillin).
Pairwise DDI needs a licensed dataset — DrugBank, First Databank, Medi-Span.

See `src/services/interactions/checker.ts`.

## Chest classifier thresholds, if this is revisited

Notes that cost time to establish:

- Scores pass through `op_norm`, which rescales each output about its own calibrated
  operating point. **0.5 means "at the threshold", not "50% likely."** An image the
  model cannot read returns ~0.5 across every label.
- Dropping time-critical pathologies below the operating point to catch them early
  produced *"pneumothorax, critical, 41%"* from an unreadable photo. Below the operating
  point the model is saying no.
- Reporting every pathology above threshold gave eleven findings on one film, led by a
  51% pneumothorax. That reads as a catastrophe and conveys nothing.

## Testing routes against a real database

**Decision:** route tests use a real database, not a mock.

Every serious defect this codebase has had was a missing `WHERE user_id` in a route
handler. A mocked database returns whatever rows it was told to regardless of the
predicate, so a handler that forgets to scope by user passes exactly as green as one
that remembers. Only real SQL fails that test.

Verified by reintroducing each original bug and confirming the tests fail — see
`src/test/route-harness.ts`.
