# NIP Rating: build spec (DRAFT for approval)

Status: draft. Nothing in this spec has been built. Items marked OPEN are undecided and must not be guessed.

NIP Rating prepares rating inputs (class code, original cost new, deductibles) for an insurance underwriter. It does not calculate a premium.

## 1. Preflight findings (measured on this tenant, app `nip_rating`)

| Question | Result | How measured |
|---|---|---|
| Sync function run time | Ran 50 s without being cut off. The skill documents 30 s; that limit was not enforced in this test. Design to 30 s anyway. | Probe slept 45 s sync |
| Async function max run time | PENDING. 40 min probe started 07:05 UTC; result recorded in section 1a. | Probe `zz-preflight-probe` |
| Async function can start another async function | YES. The child was accepted and returned an invocation id. | Probe `spawn` mode |
| Function can read a function result | YES, `sdk_client.functions.get_result(task_id)` | Probe `result` mode |
| Outbound HTTPS from a function | YES (example.com returned 200) | Probe |
| `openpyxl` | Importable | Probe |
| `pandas` | Importable | Probe |
| `pypdf` | Importable | Probe |
| `xlrd` (legacy .xls) | BLOCKED by the code scanner when imported in function code. Pandas may still read .xls internally; untested. | Scan rejected code |
| `fitz`/PyMuPDF, `pdfplumber` | Not confirmed (a scan rejected the combined test; individual results not isolated) | Probe |
| `zipfile`, `lxml` | One of these (or `PIL`) was rejected by the scanner in a combined test; not isolated | Probe |
| `google-genai` SDK | Not in the documented allowed list. Use the Gemini REST API with `requests`/`httpx`. | Skill docs |
| Memory limit, package size | Not measurable from inside the sandbox (`open()` and `os`, `sys` are blocked). Needs a Taruvi answer or a real-size test. | Probe |
| Scanner restrictions | Names starting with `_` (e.g. `__version__`, `__import__`), `exec`, and `open()` are rejected | Probe |

Leftover from preflight: the temporary function `zz-preflight-probe` must be deleted when the preflight ends.

### 1a. Async max run time

PENDING (see above).

## 2. Scraper design decision (OPEN, depends on 1a)

Decision rule from the product owner:
- If an async function can run 30+ minutes and read a streamed response: keep the NDJSON stream from `/scrape-price-digest-parallel`.
- Otherwise: change the scraper to an async job (POST returns `job_id`; results by polling or callback) and choose between polling and callback.

A recommendation will be added after 1a is known. The `nip_scraper_callback` webhook stays unbuilt until then.

## 3. Roles

| Role | Access |
|---|---|
| `nip_user` | Full working access to own runs (owner_id = user id). Read-only on reference data. |
| `nip_reviewer` | Read and export all runs. No edit, validate, report or delete on others' runs. |
| `nip_admin` | Everything, plus reference data, templates, usage reports. |

Cerbos policies check `owner_id` directly on every table. Child rows carry a denormalized `owner_id` set by the creating function, never by the frontend.

## 4. Buckets

`nip-uploads`, `nip-templates` (admin only), `nip-exports`, `nip-reports`. All private. Object paths start with the run id so that policy can follow `owner_id`.

## 5. Tables (planned; not created)

Reference: `ref_programs`, `ref_ocn_lookup`, `ref_class_codes`, `ref_rules` (also holds the stall timeouts: extraction 30 min, validation 35 min, reports 20 min).

Run data: `nip_runs`, `nip_vehicles`, `nip_validation_results`, `nip_im_items`, `nip_drivers`, `nip_reports`, `nip_exports`.

Common to run and child tables: `owner_id`, `run_id` (children), `created_at`, `updated_at`. `nip_runs` also has `status` (including `deleting`), `last_progress_at`, `program_name`, and the Insured fields.

`edited_fields` on `nip_vehicles`, `nip_im_items`, `nip_drivers`:
`{ "FIELD": { "original": ..., "edited": ..., "edited_by": "<user id>", "edited_at": "<timestamp>" } }`
The original is written the first time a field is edited and never overwritten.

Stored calculated fields on vehicles: `class_code`, `ocn_value`, BA collision/comprehensive answers and deductibles.

Unique keys for idempotent writes: `nip_vehicles (run_id, vin)`, `nip_validation_results (run_id, vin)`.

Exact field lists and types: OPEN until you give the column details. I will propose them before creating anything.

Audit logging: on `nip_runs`, `nip_vehicles`, `nip_im_items`, `nip_drivers`. Values for driver licence number and date of birth are masked. Whether Taruvi audit logging can mask individual fields is OPEN and needs checking.

PII: licence number and date of birth never go to function logs or error messages. Field-level policies on those two fields will be evaluated.

## 6. Functions (planned; not created)

| Function | Mode | Trigger | Notes |
|---|---|---|---|
| `nip_extract_run` | async | `RECORD_CREATE` on `nip_runs`; also callable for retry | Gemini `gemini-2.5-flash` via REST. Model name in config. Key in `GEMINI_API_KEY`. |
| `nip_extract_address` | sync | API | |
| `nip_validate_start` | sync | API | Applies skip rules (blank/placeholder, trailers, invalid, duplicate VINs) |
| `nip_validate_worker` | async | started by `nip_validate_start` | Calls `nip_recompute_rating` explicitly after saving results |
| `nip_validate_cancel` | sync | API | Calls scraper cancel |
| `nip_recompute_rating` | sync/async | filtered `RECORD_UPDATE` on `nip_vehicles` and callable | Watches input fields only; skips write if nothing changed |
| `nip_export_ba`, `nip_export_im` | sync/async | API | Template fidelity gated by the template spike |
| `nip_export_drivers`, `nip_export_default` | sync | API | |
| `nip_report_run` | async | API | RiskMeter, OSHA, SAFER via scraper |
| `nip_delete_run` | async | API | Resumable: set `deleting`, remove children and files, delete run last |
| `nip_reconcile_runs` | sync | schedule every 10 min | Uses `last_progress_at` and `ref_rules` timeouts |
| `nip_scraper_callback` | public webhook | OPEN | Not built until section 2 is decided |

Events do not fire for upserts or bulk/filtered deletes. Anything that must fire an event uses a plain single-row update.

## 7. Secrets (names; values entered by the product owner)

`GEMINI_API_KEY`, `SCRAPER_URL`, `SCRAPER_TOKEN`, `PRICEDIGEST_USERNAME`, `PRICEDIGEST_PASSWORD`, `PRICEDIGEST_LOGIN_URL`, `RISKMETER_USERNAME`, `RISKMETER_PASSWORD`, `RISKMETER_LOGIN_URL`.

The scraper currently has no auth. It must be changed to check `SCRAPER_TOKEN`. That work is outside Taruvi and outside this repo.

## 8. Frontend pages

- Runs list (own runs; all runs for reviewer/admin), upload modal.
- Run detail with tabs AUTO, IM, DRIVER, RiskMeter, OSHA, SAFER. Header: Program Name, export buttons, status banner polling the run row (2 s backing off to 15 s).
- Admin: reference data editor, usage reports.
- Resources register in `src/App.tsx` with `name` equal to the table name. Users come only through the `user` provider.

## 9. Build order (approved, with changes)

1. Preflight and this spec. Delete the probe function. (current)
2. Template spike: test `openpyxl` against `BA_Worksheet.xlsx` and `IM_Worksheet.xlsx` for logos, dropdowns and all sheets. Stop and report if anything is lost.
3. Roles and the ownership model.
4. Reference tables (structure only; data from the product owner).
5. Run tables, with audit logging.
6. Cerbos policies and buckets.
7. Role tests with one real test user per role (`qa_<role>_<date>`).
8. Secrets.
9. Functions in this order: recompute, extract, validation, exports, reports/delete/reconcile.
10. Frontend.

## 10. Open items

- Async maximum run time (section 1a) and the scraper design that follows.
- Memory limit and package size limit of the function runtime.
- Whether `.xls` input can be read (`xlrd` is blocked in function code).
- Whether PDF text extraction libraries are available, or whether Gemini file upload handles PDFs fully.
- Audit log masking for licence number and date of birth.
- Data-handling terms for sending real files to Gemini. Use synthetic files only until compliance confirms.
- Class code table, OCN rules, deductible rules, program details, BA/IM cell mappings (coming from the product owner).
- Callback webhook: decide after section 2.
