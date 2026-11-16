# NIP Rating: access policies (DRAFT for approval, nothing applied)

Roles created: `nip_user` (id 1354, slug `nip_rating-nip_user`), `nip_reviewer` (1355), `nip_admin` (1356).
In policy `roles[]` use the bare names `nip_user`, `nip_reviewer`, `nip_admin`, not the slugs.

## 0. Facts from the Taruvi docs that shape the design

1. Creating an app role auto-creates a **role policy** with `resource: *`, `allow_actions: *`. These three are still in place and must be narrowed (section 1).
2. New datatables get an automatic policy that grants `read` to all roles. New functions get `execute` for all roles (`roles: ["*"]`). New attachments buckets get read/create/update for all roles. Every one of these must be replaced when the resource is created.
3. Policy resource kinds: `datatable:<table>` (read, create, update, delete), `storage:<bucket>` (read, create, update, delete), `function:<slug>` (execute), `query:<slug>` (execute).
4. Platform (organization) users, superusers and API keys created by them **bypass app roles and row policies**. They are not `nip_admin`. Tests must sign in as the test users.
5. A site user with no app role is denied before row filtering (Database). Row conditions on `read` become a server-side filter, AND-merged with the caller's filters. If a condition cannot be turned into a filter, a list can come back unfiltered, so every conditional read gets a real list test.
6. Policies are per action and per resource. **There is no column-level control.**

## 1. Role policies (narrowed; replaces the allow-everything default)

| Role | Allowed (ceiling) |
|---|---|
| nip_user | `datatable:ref_*` read; `datatable:nip_*` read; `storage:nip-uploads` read, create, delete; `storage:nip-exports` read; `function:nip_*` execute |
| nip_reviewer | `datatable:ref_*` read; `datatable:nip_*` read; `storage:nip-uploads`, `nip-exports` read; `function:nip_export_*` execute; `query:nip_*` execute |
| nip_admin | `datatable:ref_*` and `datatable:nip_*` read, create, update, delete; `storage:nip-*` read, create, update, delete; `function:nip_*` execute; `query:nip_*` execute |

To verify when applied: that wildcard resource names are accepted in role policies, and how a role policy combines with a resource policy condition (test T20).

## 2. Resource policies

### 2a. Run data: nip_runs, nip_vehicles, nip_validation_results, nip_im_items, nip_drivers

```json
{"apiVersion":"api.cerbos.dev/v1","resourcePolicy":{"resource":"datatable:<table>","version":"default","rules":[
 {"actions":["read"],"effect":"EFFECT_ALLOW","roles":["nip_admin","nip_reviewer"]},
 {"actions":["read"],"effect":"EFFECT_ALLOW","roles":["nip_user"],
  "condition":{"match":{"expr":"request.resource.attr.owner_id == request.principal.id"}}},
 {"actions":["create","update","delete"],"effect":"EFFECT_ALLOW","roles":["nip_admin"]}
]}}
```

nip_user and nip_reviewer have no create, update or delete on these tables. See deviation D1.

### 2b. nip_exports

```json
{"resource":"datatable:nip_exports","rules":[
 {"actions":["read"],"effect":"EFFECT_ALLOW","roles":["nip_admin","nip_reviewer"]},
 {"actions":["read"],"effect":"EFFECT_ALLOW","roles":["nip_user"],"condition":{"match":{"expr":"request.resource.attr.owner_id == request.principal.id"}}},
 {"actions":["delete"],"effect":"EFFECT_ALLOW","roles":["nip_admin"]}
]}
```

### 2c. Reference tables: ref_programs, ref_ocn_lookup, ref_class_codes, ref_rules

```json
{"resource":"datatable:ref_*","rules":[
 {"actions":["read"],"effect":"EFFECT_ALLOW","roles":["nip_user","nip_reviewer","nip_admin"]},
 {"actions":["create","update","delete"],"effect":"EFFECT_ALLOW","roles":["nip_admin"]}
]}
```

(One policy per table when applied.)

### 2d. Buckets (all private; object path convention `<owner_id>/<run_id>/<file>`)

| Bucket | nip_user | nip_reviewer | nip_admin |
|---|---|---|---|
| nip-uploads | read, create, delete where path starts with own user id | read all | all actions |
| nip-exports | read where path starts with own user id | read all | all actions |
| nip-templates | none | none | all actions |

Functions write to exports and templates reads with their own access (to verify, T19).

Open point (T14 / T20): whether `storage:` policy conditions can see the object path. If not, ownership of files is enforced by a function (`nip_get_download`) and users get no direct read on the two buckets.

### 2e. Functions

Each function policy replaces the automatic `roles: ["*"]` rule.

| Function | Execute (Cerbos) | In-code check (caller = `user_data`) |
|---|---|---|
| nip_create_run (proposed) | nip_user, nip_admin | owner_id forced to caller; file_ref must start with caller id |
| nip_save_edits (proposed) | nip_user, nip_admin | run owner or nip_admin; rejects owner_id, calculated and status fields; writes edited_fields and updated_at |
| nip_extract_run (retry call) | nip_user, nip_admin | run owner or nip_admin |
| nip_validate_start | nip_user, nip_admin | run owner or nip_admin |
| nip_validate_cancel | nip_user, nip_admin | run owner or nip_admin |
| nip_delete_run | nip_user, nip_admin | run owner or nip_admin |
| nip_export_ba, nip_export_im, nip_export_drivers, nip_export_default | nip_user, nip_reviewer, nip_admin | run owner, nip_reviewer or nip_admin |
| nip_recompute_rating | no app role | event or internal call only |
| nip_validate_worker | no app role | internal call only |
| nip_reconcile_runs | no app role | scheduled only |
| nip_scraper_callback | OPEN (not built) | |
| nip_get_download (only if T14 fails) | nip_user, nip_reviewer, nip_admin | owner, reviewer or admin |

Nothing in this table is callable by a user with no NIP role. To verify (T19): whether a function runs as the caller or with its own access, and whether internal calls need the caller to hold execute on the callee.

### 2f. Analytics queries and audit log

- `query:nip_usage_*`: execute for nip_reviewer, nip_admin. Management is by platform admins.
- Audit: Taruvi keeps one `audit_log` table per tenant, and this tenant hosts other apps. Giving a role direct read could expose other apps' records. Proposal: a saved query `nip_audit_view` limited to the NIP tables, `query:` execute for nip_reviewer and nip_admin, and no direct audit_log access. Needs your confirmation.

## 3. Deviations from your access matrix

- **D1: no direct create or update by nip_user on run data.** Policies cannot restrict columns or force `owner_id` on create, and `edited_fields` (original value, who, when) cannot be trusted if the browser writes it. Writes go through `nip_create_run` and `nip_save_edits`. If tests on a real table show payload-aware conditions work, a direct-write variant is possible.
- **D2: audit log access via a query**, not a table (above).
- **D3: reviewer sees driver names, date of birth and licence number** (default yes). No column-level policy exists. Hiding them later means a separate `nip_driver_pii` table, which is cheaper to decide before `nip_drivers` is created.

## 4. Open questions (defaults in brackets)

1. Site admins: platform users already bypass everything and cannot be restricted. [No automatic mapping; humans get `nip_admin` explicitly.]
2. Reviewer sees PII [yes]. Fields: first_name, middle_name, last_name, date_of_birth, date_of_birth_raw, license_state, license_number.
3. Teams or branches [no].
4. Approve two functions beyond your list: `nip_create_run`, `nip_save_edits`.
5. Approve the audit query approach.
6. Approve narrowing the three role policies now, before tables exist.

## 5. Test plan

"Ran" results are exact; see section 6.

| # | Who | Action and resource | Expected | Can run now? | Status |
|---|---|---|---|---|---|
| S1 | all five | Sign in | success | yes | **ran: all HTTP 200** |
| S2 | none | Unauthenticated GET `/api/users/me/` and `auth_user` data | deny | yes | **ran: 401 and 403** |
| S3 | all five | GET `auth_user` datatable | deny | yes | **ran: 403 for all** |
| 1 | user_a | Create run via `nip_create_run`; owner_id = user_a | ALLOW | waits: tables, function | waiting |
| 2 | user_a | Create run with owner_id = user_b | owner forced to user_a | waits: tables, function | waiting |
| 3 | user_a | Read own run; read user_b's run | ALLOW; DENY | waits: tables | waiting |
| 4 | user_a | Change owner_id on own run | DENY | waits: tables | waiting |
| 5 | user_a | Change class_code or validation_status directly | DENY | waits: tables | waiting |
| 6 | user_a | Edit vehicle make on own row via `nip_save_edits` | ALLOW | waits: tables, function | waiting |
| 7 | user_a | Direct table delete of own run; `nip_delete_run` | DENY; ALLOW | waits: tables, function | waiting |
| 8 | reviewer_1 | Read every run and its children | ALLOW | waits: tables | waiting |
| 9 | reviewer_1 | Create, update, delete any run row | DENY | waits: tables | waiting |
| 10 | reviewer_1 | Read files in nip-uploads, nip-exports; upload to nip-uploads | ALLOW; DENY | waits: buckets | waiting |
| 11 | admin_1 | Read, update, delete any run; edit reference data | ALLOW | waits: tables | waiting |
| 12 | user_a, reviewer_1 | Edit reference data; read it | DENY; ALLOW | waits: tables | waiting |
| 13 | norole_1 | Read anything in the app | DENY | waits: tables, buckets | waiting |
| 14 | user_a | Read user_b's file in nip-uploads by path | DENY | waits: buckets | waiting |
| 15 | user_a; admin_1 | Read nip-templates | DENY; ALLOW | waits: buckets | waiting |
| 16 | user_a; reviewer_1 | Audit view | DENY; ALLOW | waits: audit query | waiting |
| 17 | user_a | Read user_b's nip_vehicles rows by run_id | DENY (no rows) | waits: tables | waiting |
| 18 | none | Unauthenticated call to table and bucket | DENY | waits: tables, buckets | waiting |
| 19 | any | Function identity: does a function write bypass the caller's table policy; does an internal call need caller execute | function writes succeed | waits: tables, functions | waiting |
| 20 | user_a | Role policy plus resource policy condition combine as designed; list is filtered with correct `total` | own rows only | waits: tables | waiting |
| 21 | reviewer_1 | Call `nip_validate_start` | DENY | waits: functions | waiting |
| 22 | norole_1 | Call any `nip_*` function | DENY | waits: functions | waiting |
| 23 | user_a | `nip_save_edits` on user_b's run | refused | waits: functions | waiting |
| 24 | user_a | `nip_save_edits` setting class_code | refused | waits: functions | waiting |
| 25 | reviewer_1 | Call an export function on user_a's run | ALLOW | waits: functions | waiting |

## 6. Test results so far

Site `https://insurance.taruvi.cloud`, app `nip_rating`, from `%TEMP%\nip_signin_test.ps1`.

```
S2 GET /api/users/me/ (no credentials) -> HTTP 401
S2 GET /api/apps/nip_rating/datatables/auth_user/data/ (no credentials) -> HTTP 403
S1 POST /_allauth/app/v1/auth/login user_a      -> HTTP 200 authenticated=True access_token_present=True
   GET /api/users/me/ -> HTTP 200 ; GET .../datatables/auth_user/data/?page_size=1 -> HTTP 403
S1 ... user_b, reviewer_1, admin_1, norole_1 -> each HTTP 200 authenticated=True; /api/users/me/ HTTP 200; auth_user data HTTP 403
```

## 7. Removing the test users afterwards

Revoke roles (`manage_role_assignments` revoke), then deactivate or delete `qa_user_a_20261111`, `qa_user_b_20261111`, `qa_reviewer_1_20261111`, `qa_admin_1_20261111`, `qa_norole_1_20261111`, or ask me to do it.
