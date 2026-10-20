# Medication knowledge and interaction coverage

This feature uses exact RxNorm identity lookups and verified ingredient relationships. It
ships with **drug–drug interaction screening unavailable**. There is no configured or
licensed clinical interaction data source, and an empty finding list does not imply safety.
No LLM output is accepted as interaction evidence or as a severity classification.

## Evaluated sources

| Source | Available capability | Access, coverage and suitability |
| --- | --- | --- |
| [NLM RxNav FAQ](https://www.lhncbc.nlm.nih.gov/RxNav/information/FAQs.html) | RxNorm identity and RxClass terminology; its interaction feature was discontinued January 2, 2024. | The ordinary terminology APIs generally do not require a license. They are not a replacement interaction database. Local Pakistani brands may remain unresolved. |
| [DrugBank Clinical API](https://docs.drugbank.com/api-docs) | Pairwise `/v1/ddi` responses can include descriptions, source severity, evidence levels and references (`include_references=true`). | API keys and an appropriate agreement are required. Supported inputs include DrugBank IDs, regional product identifiers and product concepts; RxCUI mapping must be independently validated before a provider adapter is enabled. Region availability follows the subscription. Neither Pakistan product coverage nor a version/update guarantee has been established for this deployment. |
| [DrugBank terms](https://trust.drugbank.com/drugbank-trust-center/terms-of-use) | Contractual use conditions. | These terms place restrictions on reuse, redistribution and safety-critical uses. No data was scraped, bundled or assumed licensed. An applicable clinical-use agreement must be reviewed before deployment with this provider. |
| [DailyMed web services](https://dailymed.nlm.nih.gov/dailymed/app-support-web-services.cfm) | Current structured product labels, label history and downloadable prescribing information. | Label retrieval is not comprehensive pairwise interaction screening. Automatically extracting clinical rules from label prose would require an independently validated process; none is claimed here. |
| [FDB drug interaction module](https://www.fdbhealth.com/solutions/medknowledge-drug-database/medknowledge-clinical-modules/drug-drug-interaction) | Commercial interaction knowledge, including evidence and severity. | Requires a separately evaluated agreement and integration; none is configured. |
| [FDB international services](https://www.fdbhealth.info/) | International knowledge can be associated with local formularies through identifier mapping. | Pakistan-specific coverage, validation and update terms remain procurement and clinical-review questions. |

The deployment has no verified update schedule or licensed interaction dataset version.
The UI reports provider availability, returned data version when supplied, evaluation time
and limitations separately. RxNorm retrieval time is recorded; a retrieval timestamp is not
presented as a knowledge-data version.

## Integration boundary

`InteractionProvider.lookupPair` accepts only two verified numeric RxCUIs and an abort
signal. It receives no owner ID, document ID, name, source text, allergy record or patient
history. A future adapter must perform authorized identifier conversion and return the same
pair, provider version, evidence basis, HTTPS reference, and provider-defined severity (or
null if the provider does not define one). A response for another pair or with invalid
evidence fails closed as unchecked coverage.

The default adapter makes no network requests. Optional adapters run at concurrency four,
at most 40 unique pairs per evaluation, with a three-second timeout per pair. Expansion
across repeated medication records is capped at 2,000 provider findings and explicitly
reports partial coverage if more findings exist. Successful
results have a bounded process cache (500 pairs per provider instance, 15-minute expiry);
failed requests are not cached as negative results. Credentials belong exclusively in the
server adapter, never in browser code or this contract.

Coverage distinguishes available, partial, unsupported, unavailable and failed. An outage
cannot hide medication history or become “no interactions found.” Duplicate ingredients,
exact source entries, and recorded allergy matches are separate deterministic findings.
Therapeutic duplication and cross-reactivity remain unsupported: ATC class similarity is
not itself sufficient evidence for either.

## Normalization limits

Only one exact RxNorm name match is accepted. Ambiguous names, uncertain OCR, unmatched
brands and unsupported concepts remain unresolved. Combination products retain every
verified ingredient; a broad brand family with multiple possible ingredients remains
ambiguous. Ingredient lookup failures never cause a product name or ID to be invented as
an ingredient. Release form, strength, route and actual patient use remain separately
documented facts, even when identity is verified.

Patient name corrections invalidate the source identity for current safety screening until
verified; original documented data is preserved. Similar spelling alone never establishes
medication equivalence, allergy cross-reactivity or therapeutic duplication.
