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
| `nip_reviewer` | Read and export all runs. No edit, validate or delete on others' runs. |
| `nip_admin` | Everything, plus reference data, templates, usage reports. |

Cerbos policies check `owner_id` directly on every table. Child rows carry a denormalized `owner_id` set by the creating function, never by the frontend.

## 4. Buckets

`nip-uploads`, `nip-templates` (admin only), `nip-exports`. All private. Object paths start with the run id so that policy can follow `owner_id`.

## 5. Tables (planned; not created)

Reference: `ref_programs`, `ref_ocn_lookup`, `ref_class_codes`, `ref_rules` (also holds the stall timeouts: extraction 30 min, validation 35 min).

Run data: `nip_runs`, `nip_vehicles`, `nip_validation_results`, `nip_im_items`, `nip_drivers`, `nip_exports`.

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
| `nip_extract_run` | sync | API (retry) | Sets the run to processing and starts `nip_extract_worker`. New runs are started by `nip_create_run` (no `RECORD_CREATE` subscription). |
| `nip_extract_worker` | async | started by `nip_create_run` / `nip_extract_run` | Deployed v15 (2026-11-19). For IM a `_WKST` bookmark is a worksheet copy (on APP 5 a 408-page asset inventory): it is read only when the plain IM section gives no rows (`worksheet_fallback_tabs` in `extract_section_patterns`). Earlier rows are deleted 100 ids per call (500 ids exceeds the URL limit). First deployed v13, `docs/functions/nip_extract_worker.py`. Reads PDF bookmarks and plans passes per tab variant (AUTO / IM / DRIVER, base and revised) plus ACORD pages for INSURED and PREMISES; a tab with no bookmark gets one full-document pass; no recognised bookmark = one full pass. Cuts passes into parts (5 pages when a pass is over 20 pages, halved while a part has more than 40 VINs in its text, a page with more than 60 VINs read in row batches of 40) and runs 6 parts at the same time as async `nip_extract_part` calls. Keeps the variant with more rows (tie: more filled fields). Clean-up in code (VIN O/I fix, stated amount equal to a deductible cleared, exact-duplicate and empty rows dropped, IM de-dup by serial, driver validity and de-dup, premises key, garaging filled from premises); changes are recorded in `edited_fields` with the original value. Saves the plan, chosen variants, timing, premises and unread pages in `extraction_progress`; unread pages also go to `extraction_error` while the status is `complete`. Patterns and numbers: `ref_rules` `extract_section_patterns`, `extract_settings`, `gemini_model`. |
| `nip_extract_part` | async | started by `nip_extract_worker` | Deployed v2, `docs/functions/nip_extract_part.py`. One part: Gemini (temperature 0.1, JSON, 65536 output tokens, 10-minute timeout), up to 2 repair calls for VINs found in the page text but missing from the answer, a multi-page part under 85% VIN coverage is halved (up to 3 levels), JSON repair for truncated answers. Returns failed pages instead of failing. Mock sample when `GEMINI_API_KEY` is not set. Saves nothing. |
| `nip_validate_start` | sync | API | Deployed v7 (2026-11-20), `docs/functions/nip_validate_start.py`. Applies skip rules (blank/placeholder, trailers, invalid, duplicate VINs). Fixes look-alike characters (I/O/Q, Cyrillic/Greek). Checks the VIN check digit (position 9) of North American VINs (first character 1 to 5): when it is wrong and exactly one common misread (S/5, B/8, B/G, G/6, Z/2, D/0, U/V, X/K, or a swap of two neighbouring characters) gives a correct check digit, the VIN is corrected and the original kept in `edited_fields` (`system (VIN check digit)`); otherwise nothing is changed and the count goes to `queue_diagnostics.checkDigitWarnCount`. The Vehicles tab shows a CHECK DIGIT chip on such VINs. |
| `nip_validate_worker` | async | started by `nip_validate_start` | Calls `nip_recompute_rating` explicitly after saving results |
| `nip_validate_cancel` | sync | API | Calls scraper cancel |
| `nip_recompute_rating` | sync/async | filtered `RECORD_UPDATE` on `nip_vehicles` and callable | Written: `docs/functions/nip_recompute_rating.py`. Rules in `docs/rating-rules.md`. Watches input fields only (body_type, model, make, year, cost_new, comp_otc, coll, sic, garaging_state); writes one row at a time and skips the write if nothing changed. Params: `run_id`, optional `vehicle_ids`. Deployed 2026-11-16. No event trigger: `nip_save_edits` calls it directly after an edit to a rating input, and `nip_validate_worker` calls it after validation. |
| `nip_export_ba`, `nip_export_im` | sync | API | Deployed. Each export is one `.xlsx` with every row, like the original app: the template's prepared rows (BA 6 to 158, IM 6 to 82) are filled in place and further rows are copied from the last prepared row, with the header filter extended. The response still carries `file_ref`/`file_name` plus `files[]` (one entry). BA lists rows with a VIN only, numbered 1, 2, 3; IM skips repeated items (same serial number, else same description and limit) and writes descriptions in title case. |
| `nip_export_drivers`, `nip_export_default` | sync | API | Deployed. Drivers CSV skips repeats (same licence state + number, else same first + last name + date of birth) and reports the count in `warning`. |
| `nip_ensure_role` | sync | API, any signed-in user | Deployed 2026-11-18, `docs/functions/nip_ensure_role.py`. Gives the caller `nip_user` when they hold no NIP or Super Admin role. Changes only the caller and only to `nip_user`; an admin may name another person (for tests). Called once per browser session by `src/components/auth/EnsureNipRole.tsx`, which reloads the page after a role is assigned. Uses the secret `NIP_SERVICE_API_KEY` when present, else the caller's own access. |
| `nip_manage_users` | sync | API, Super Admin only (checked in code) | Deployed 2026-11-18, `docs/functions/nip_manage_users.py`. `action: "list"` returns every tenant user with name, email, active flag, last sign-in, joined date and NIP role (filter by role, search, paging, role counts). `action: "set_role"` changes one person to `nip_user`, `nip_reviewer` or `nip_admin`: it adds the new role first, then removes the other NIP roles. Never changes a Super Admin or gives Super Admin. Used by the Admin tab "People and roles" (`src/pages/admin/UsersPanel.tsx`), shown to Super Admins only. |
| `nip_delete_run` | async | API | Resumable: set `deleting`, remove children and files, delete run last |
| `nip_reconcile_runs` | sync | schedule every 10 min | Uses `last_progress_at` and `ref_rules` timeouts |
| `nip_scraper_callback` | public webhook | OPEN | Not built until section 2 is decided |

Events do not fire for upserts or bulk/filtered deletes. Anything that must fire an event uses a plain single-row update.

## 7. Secrets (names; values entered by the product owner)

`GEMINI_API_KEY`, `SCRAPER_URL`, `SCRAPER_TOKEN`, `PRICEDIGEST_USERNAME`, `PRICEDIGEST_PASSWORD`, `PRICEDIGEST_LOGIN_URL`.

The scraper currently has no auth. It must be changed to check `SCRAPER_TOKEN`. That work is outside Taruvi and outside this repo.

## 8. Frontend pages

- Runs list (own runs; all runs for reviewer/admin), upload modal.
- Run detail with tabs AUTO, IM, DRIVER. Header: Program Name, export buttons, status banner polling the run row (2 s backing off to 15 s).
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
9. Functions in this order: recompute, extract, validation, exports, delete/reconcile.
10. Frontend.

## 10. Open items

- Async maximum run time (section 1a) and the scraper design that follows.
- Memory limit and package size limit of the function runtime.
- Whether `.xls` input can be read (`xlrd` is blocked in function code).
- Whether PDF text extraction libraries are available, or whether Gemini file upload handles PDFs fully.
- Audit log masking for licence number and date of birth.
- Data-handling terms for sending real files to Gemini. Use synthetic files only until compliance confirms.
- Program details and BA/IM cell mappings (coming from the product owner).
- Class code table, OCN lookup, vehicle type detection and the 20 worked examples were received. See `docs/rating-rules.md` and `docs/reference-data/`. Checked against the old code: the dump rule, the deductible cut-offs and the Treepro calculator rule. Still open: the BODY_TYPE keyword fallback for the OCN vehicle type, whether SIC can be longer than two digits, the "utility" fix (try one real SUV), and the OCN workbook comparison.
- Callback webhook: decide after section 2.
