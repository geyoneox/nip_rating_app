/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeFunction } from "../utils/functionHelpers";
import { taruviStorageProvider } from "../providers/refineProviders";

// ---------------------------------------------------------------------------
// Names (buckets, functions). Keep in one place so a rename is one edit.
// ---------------------------------------------------------------------------
export const BUCKETS = {
  uploads: "nip-uploads",
  templates: "nip-templates",
  exports: "nip-exports",
} as const;

export const FN = {
  createRun: "nip_create_run",
  saveEdits: "nip_save_edits",
  deleteRun: "nip_delete_run",
  extractRun: "nip_extract_run",
  validateStart: "nip_validate_start",
  validateCancel: "nip_validate_cancel",
  scraperStatus: "nip_scraper_status",
  recompute: "nip_recompute_rating",
  exportBa: "nip_export_ba",
  exportIm: "nip_export_im",
  exportDrivers: "nip_export_drivers",
  exportDefault: "nip_export_default",
} as const;

// ---------------------------------------------------------------------------
// Row types (mirror docs/nip_schema_v1.json)
// ---------------------------------------------------------------------------
export type Progress = { processed: number; total: number } | null;

/** What nip_extract_worker saves in extraction_progress when it finishes. */
export type ExtractionSummary = {
  processed: number;
  total: number;
  seconds?: number;
  passes?: { name: string; pages: number }[];
  choices?: Record<string, { chosen: "base" | "revised"; chosen_titles?: string[]; rows: number; other?: string; other_titles?: string[]; other_rows?: number }>;
  cleanup?: { vin_fixed?: number; stated_cleared?: number; stated_basis?: number; garaging_from_premises?: number };
  premises?: Record<string, string | null>[];
  warnings?: { pages: string; pass: string; reason: string }[];
  mock?: boolean;
};

export type NipRun = {
  id: string;
  owner_id: string;
  file_name: string;
  file_ref: string;
  source_type: "pdf" | "xlsx" | "xls";
  program_id?: string | null;
  epic_id?: string | null;
  policy_number?: string | null;
  broker_email?: string | null;
  insured_name?: string | null;
  insured_mailing_address?: string | null;
  insured_city?: string | null;
  insured_state?: string | null;
  insured_zip?: string | null;
  insured_sic?: string | null;
  im_valuation_type?: string | null;
  extraction_status: "processing" | "complete" | "failed";
  extraction_progress?: Progress;
  extraction_error?: string | null;
  validation_status: "not_started" | "processing" | "complete" | "cancelled" | "failed";
  validation_progress?: Progress;
  validation_error?: string | null;
  validation_cancel_requested?: boolean;
  queue_diagnostics?: Record<string, number> | null;
  active_job_id?: string | null;
  lifecycle_status: "active" | "deleting";
  last_progress_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type NipVehicle = {
  id: string;
  run_id: string;
  owner_id: string;
  row_number: number;
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  body_type?: string | null;
  year_raw?: string | null;
  year?: number | null;
  garaging_address?: string | null;
  garaging_city?: string | null;
  garaging_county?: string | null;
  garaging_state?: string | null;
  garaging_zip?: string | null;
  radius_raw?: string | null;
  radius?: number | null;
  cost_new_raw?: string | null;
  cost_new?: number | null;
  is_trailer: boolean;
  is_duplicate: boolean;
  edited_fields?: Record<string, any> | null;
  class_code?: string | null;
  ocn_value?: number | null;
};

export type NipValidationResult = {
  id: string;
  run_id: string;
  vin: string;
  success: boolean;
  skipped: boolean;
  error?: string | null;
  is_tractor?: string | null;
  gross_vehicle_weight?: number | null;
  gross_combine_weight?: number | null;
  complete_incomplete?: string | null;
  msrp?: number | null;
  retail_value?: number | null;
  wholesale_value?: number | null;
  pd_make?: string | null;
  pd_model?: string | null;
  pd_year?: string | null;
  vehicle_type?: string | null;
  vehicle_subtype?: string | null;
};

export type NipImItem = {
  id: string;
  run_id: string;
  row_number: number;
  type?: string | null;
  manufacturer?: string | null;
  description?: string | null;
  model?: string | null;
  model_year?: string | null;
  serial_no?: string | null;
  amount_of_insurance_raw?: string | null;
  amount_of_insurance?: number | null;
  full_description?: string | null;
  is_small_tool?: boolean;
  is_crane?: boolean;
  is_duplicate?: boolean;
  edited_fields?: Record<string, any> | null;
};

export type NipDriver = {
  id: string;
  run_id: string;
  row_number: number;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  date_of_birth_raw?: string | null;
  license_state?: string | null;
  license_number?: string | null;
  is_duplicate?: boolean;
  edited_fields?: Record<string, any> | null;
};

// ---------------------------------------------------------------------------
// Status badge for the Runs list
// ---------------------------------------------------------------------------
export type RunStatusLabel =
  | "Validating"
  | "Cancelled"
  | "Failed"
  | "Validated"
  | "Extracted"
  | "Processing";

export const STATUS_FILTERS: Array<"All Status" | RunStatusLabel> = [
  "All Status",
  "Processing",
  "Extracted",
  "Validating",
  "Validated",
  "Cancelled",
  "Failed",
];

export function runStatus(run: Pick<NipRun, "extraction_status" | "validation_status">): {
  label: RunStatusLabel;
  color: "default" | "primary" | "success" | "error" | "warning" | "info";
} {
  if (run.validation_status === "processing") return { label: "Validating", color: "info" };
  if (run.validation_status === "cancelled") return { label: "Cancelled", color: "warning" };
  if (run.extraction_status === "failed" || run.validation_status === "failed")
    return { label: "Failed", color: "error" };
  if (run.validation_status === "complete") return { label: "Validated", color: "success" };
  if (run.extraction_status === "complete") return { label: "Extracted", color: "primary" };
  return { label: "Processing", color: "default" };
}

/** Server-side filters equivalent to each badge (so filtering is not done in React). */
export function statusToFilters(label: string): any[] {
  switch (label) {
    case "Validating":
      return [{ field: "validation_status", operator: "eq", value: "processing" }];
    case "Cancelled":
      return [{ field: "validation_status", operator: "eq", value: "cancelled" }];
    case "Failed":
      return [
        {
          operator: "or",
          value: [
            { field: "extraction_status", operator: "eq", value: "failed" },
            { field: "validation_status", operator: "eq", value: "failed" },
          ],
        },
      ];
    case "Validated":
      return [{ field: "validation_status", operator: "eq", value: "complete" }];
    case "Extracted":
      return [
        { field: "extraction_status", operator: "eq", value: "complete" },
        { field: "validation_status", operator: "eq", value: "not_started" },
      ];
    case "Processing":
      return [
        { field: "extraction_status", operator: "eq", value: "processing" },
        { field: "validation_status", operator: "eq", value: "not_started" },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// VIN rules (same as the validation start function)
// ---------------------------------------------------------------------------
export const PLACEHOLDER_VINS = [
  "NEED",
  "NEEDED",
  "NA",
  "NONE",
  "UNKNOWN",
  "NOTAVAILABLE",
  "NOTAPPLICABLE",
  "TBD",
  "PENDING",
];
/** Class codes of the three trailer types (semi trailer, utility trailer, trailer), standard and special-state. */
export const TRAILER_CLASS_CODES = ["67489", "67589", "68489", "68589", "69489", "69589"];
export const normalizeVin = (v?: string | null) => (v ?? "").toUpperCase().replace(/\s+/g, "");
export const isPlaceholderVin = (v?: string | null) =>
  PLACEHOLDER_VINS.includes(normalizeVin(v).replace(/[^A-Z]/g, ""));
export const isValidVin = (v?: string | null) => /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizeVin(v));

const VIN_VALUES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * False when a North American VIN (first character 1 to 5) fails its check digit (position 9), which almost
 * always means a character was misread. Other VINs, and VINs that are not 17 valid characters, return true.
 */
export function vinCheckDigitOk(v?: string | null): boolean {
  const s = normalizeVin(v);
  if (!isValidVin(s) || !"12345".includes(s[0])) return true;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = s[i];
    sum += (/\d/.test(c) ? Number(c) : VIN_VALUES[c]) * VIN_WEIGHTS[i];
  }
  const r = sum % 11;
  return (r === 10 ? "X" : String(r)) === s[8];
}

export function failureReason(r: Pick<NipValidationResult, "error">): string {
  const e = (r.error ?? "").toLowerCase();
  if (!e) return "Failed";
  if (e.includes("length") || e.includes("format") || e.includes("invalid vin"))
    return "Invalid VIN length or format";
  if (e.includes("timeout") || e.includes("connection") || e.includes("timed out"))
    return "Scraper service connection timeout";
  // any other PriceDigest error text is grouped, so one filter pill covers it
  return "PriceDigest lookup failed";
}

// ---------------------------------------------------------------------------
// Parsing and formatting
// ---------------------------------------------------------------------------
export function parseNumber(s: string): number | null {
  const cleaned = s.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
export const fmtMoney = (n?: number | null) =>
  n == null ? "" : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const fmtNum = (n?: number | null) => (n == null ? "" : n.toLocaleString());
export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString() : "");
export const safeFileName = (name: string) =>
  name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, ".");
export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/[x]/g, () =>
        Math.floor(Math.random() * 16).toString(16),
      );

// ---------------------------------------------------------------------------
// Function calls: unwrap the envelope and turn failures into plain messages
// ---------------------------------------------------------------------------
export function errorMessage(e: unknown): string {
  const err = e as any;
  const status = err?.statusCode ?? err?.status ?? err?.response?.status;
  const raw: string | undefined =
    err?.response?.data?.error ?? err?.response?.data?.message ?? err?.message;
  if (status === 403) return "You do not have permission to do that.";
  if (status === 404) return "This action is not available yet.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (!raw) return "Something went wrong. Please try again.";
  // never show stack traces or long technical text
  const firstLine = String(raw).split("\n")[0];
  return firstLine.length > 240 ? firstLine.slice(0, 240) + "…" : firstLine;
}

function unwrap(raw: any): any {
  let cur = raw;
  for (let i = 0; i < 4; i++) {
    if (cur && typeof cur === "object" && "success" in cur) return cur;
    if (cur && typeof cur === "object") cur = cur.result ?? cur.data ?? null;
    else break;
  }
  return raw;
}

export async function callFn<T = any>(slug: string, payload: Record<string, unknown>): Promise<T> {
  try {
    const raw = await executeFunction(slug, payload);
    const out = unwrap(raw);
    if (out && typeof out === "object" && out.success === false) {
      throw new Error(out.error || out.message || "The request could not be completed.");
    }
    return out as T;
  } catch (e) {
    throw new Error(errorMessage(e));
  }
}

// ---------------------------------------------------------------------------
// Downloads: authenticated fetch through the storage provider, never a stored key
// ---------------------------------------------------------------------------
export async function downloadFromBucket(bucket: string, path: string, fileName: string) {
  const res: any = await taruviStorageProvider.getOne({ resource: bucket, id: path, meta: {} });
  const d = res?.data;
  if (d instanceof Blob) {
    saveBlob(d, fileName);
    return;
  }
  if (d?.url) {
    window.open(d.url, "_blank", "noopener");
    return;
  }
  throw new Error("The file could not be downloaded.");
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Open a link returned by an export function (signed link or authenticated path). */
export async function openExport(result: any) {
  const url: string | undefined = result?.url ?? result?.download_url ?? result?.signed_url;
  const name: string = result?.file_name ?? "export";
  if (url) {
    window.open(url, "_blank", "noopener");
    return;
  }
  // Large runs are split into several workbooks: download each one in turn.
  const files: { file_ref: string; file_name?: string }[] = Array.isArray(result?.files)
    ? result.files.filter((f: any) => f?.file_ref)
    : [];
  if (files.length > 1) {
    for (let i = 0; i < files.length; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 700));
      await downloadFromBucket(BUCKETS.exports, files[i].file_ref, files[i].file_name ?? `${name}-${i + 1}`);
    }
    return;
  }
  if (result?.file_ref) {
    await downloadFromBucket(BUCKETS.exports, result.file_ref, name);
    return;
  }
  throw new Error("The export finished but no download link was returned.");
}

// ---------------------------------------------------------------------------
// Edits go through nip_save_edits (users have no direct write access to tables).
// Contract: { run_id, target, record_id?, changes: { field: rawValue } }
//   target: "run" | "vehicle" | "im_item" | "driver"
// The function parses raw text into the typed column, keeps the first original
// in edited_fields, and sets updated_at.
// ---------------------------------------------------------------------------
export type EditTarget = "run" | "vehicle" | "im_item" | "driver";

export async function saveEdit(
  runId: string,
  target: EditTarget,
  recordId: string | null,
  changes: Record<string, string | null>,
) {
  return callFn(FN.saveEdits, { run_id: runId, target, record_id: recordId, changes });
}

// ---------------------------------------------------------------------------
// Refine v5 result shapes differ slightly between hooks; read both safely.
// ---------------------------------------------------------------------------
export function pickList<T = any>(q: any): T[] {
  const r = q?.result;
  if (Array.isArray(r?.data)) return r.data as T[];
  if (Array.isArray(r)) return r as T[];
  const d = q?.query?.data?.data;
  return Array.isArray(d) ? (d as T[]) : [];
}
export function pickTotal(q: any): number {
  return q?.result?.total ?? q?.query?.data?.total ?? pickList(q).length;
}
export function pickOne<T = any>(q: any): T | undefined {
  const r = q?.result;
  if (r && typeof r === "object" && "id" in r) return r as T;
  if (r?.data && typeof r.data === "object" && !Array.isArray(r.data)) return r.data as T;
  const d = q?.query?.data?.data;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as T) : undefined;
}

export const HIDDEN_VALUE = "••••••";
