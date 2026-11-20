/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import CheckBoxRoundedIcon from "@mui/icons-material/CheckBoxRounded";
import HourglassBottomRoundedIcon from "@mui/icons-material/HourglassBottomRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { WideTable, type WideCol } from "../../../components/WideTable";
import {
  FN,
  callFn,
  failureReason,
  fmtMoney,
  fmtNum,
  isPlaceholderVin,
  TRAILER_CLASS_CODES,
  isValidVin,
  vinCheckDigitOk,
  normalizeVin,
  saveEdit,
  type NipRun,
  type NipValidationResult,
  type NipVehicle,
} from "../../../lib/nip";

type Props = {
  run: NipRun;
  vehicles: NipVehicle[];
  results: NipValidationResult[];
  canEdit: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
  onRefresh: () => void;
};

type VRow = NipVehicle & { _res?: NipValidationResult; _vin: string };
type Tone = "error" | "success" | "warning" | "info";

const Stat = ({
  label,
  value,
  tone,
  tint,
  icon,
  large,
}: {
  label: string;
  value: number | string;
  tone?: Tone;
  tint?: Tone;
  icon?: ReactNode;
  /** The four status cards (total, passed, failed, pending): taller, upper-case label, bigger number. */
  large?: boolean;
}) => (
  <Card
    variant="outlined"
    sx={(t) => ({
      p: 0,
      minWidth: large ? 200 : 150,
      flex: large ? "1 1 200px" : "1 1 150px",
      boxShadow: "none",
      bgcolor: tint ? alpha(t.palette[tint].main, 0.08) : "background.paper",
      borderColor: tint ? alpha(t.palette[tint].main, 0.35) : "divider",
    })}
  >
    <CardContent sx={{ px: 2, py: large ? 2.25 : 1.5, "&:last-child": { pb: large ? 2.25 : 1.5 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography
          variant={large ? "overline" : "body2"}
          sx={{ fontWeight: 600, lineHeight: 1.4 }}
          color={tint ? `${tint}.dark` : "text.secondary"}
        >
          {label}
        </Typography>
        {icon}
      </Stack>
      <Typography variant={large ? "h2" : "h4"} component="p" sx={{ mt: 0.5 }} color={tone ? `${tone}.dark` : "text.primary"}>
        {value}
      </Typography>
    </CardContent>
  </Card>
);

const edited = (row: NipVehicle, field: string) => Boolean(row.edited_fields && row.edited_fields[field]);

export const AutoTab = ({ run, vehicles, results, canEdit, onChanged, onError, onRefresh }: Props) => {
  const running = run.validation_status === "processing";
  const [hideDup, setHideDup] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resByVin = useMemo(() => {
    const m = new Map<string, NipValidationResult>();
    results.forEach((r) => m.set(normalizeVin(r.vin), r));
    return m;
  }, [results]);

  const rows: VRow[] = useMemo(
    () => vehicles.map((v) => ({ ...v, _vin: normalizeVin(v.vin), _res: resByVin.get(normalizeVin(v.vin)) })),
    [vehicles, resByVin],
  );

  // counts: trailers and hidden duplicates are not counted
  const counted = rows.filter((r) => !r.is_trailer && !r.is_duplicate);
  const passed = counted.filter((r) => r._res?.success).length;
  const failedRows = counted.filter((r) => r._res && !r._res.success && !r._res.skipped);
  // Pending = a valid VIN that has no result yet. Rows with no VIN, a placeholder or an invalid VIN are never
  // sent for validation, so they are counted as skipped, not pending.
  const pending = counted.filter((r) => !r._res && isValidVin(r.vin) && !isPlaceholderVin(r.vin)).length;
  const skippedRows = counted.length - passed - failedRows.length - pending;
  const dup = rows.filter((r) => r.is_duplicate).length;
  // every row, duplicates included, that is a trailer: flagged at extraction or rated with a trailer class code
  const trailerRows = rows.filter((r) => r.is_trailer || (r.class_code != null && TRAILER_CLASS_CODES.includes(String(r.class_code)))).length;
  const diag = run.queue_diagnostics ?? {};
  // VINs whose check digit is wrong were very likely misread from the application
  const checkDigitRows = rows.filter((r) => !r.is_duplicate && !r.is_trailer && r.vin && !vinCheckDigitOk(r.vin));

  const reasons = useMemo(() => {
    const m = new Map<string, number>();
    failedRows.forEach((r) => {
      const k = failureReason(r._res!);
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries());
  }, [failedRows]);

  const shown = rows.filter((r) => {
    if (hideDup && r.is_duplicate) return false;
    if (reasonFilter) return r._res && !r._res.success && !r._res.skipped && failureReason(r._res) === reasonFilter;
    return true;
  });

  const eligible = (r: VRow) => !r.is_duplicate && !r.is_trailer && isValidVin(r.vin) && !isPlaceholderVin(r.vin);

  // drop selections that are no longer eligible (e.g. after an edit or refresh)
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(rows.filter(eligible).map((r) => r.id));
      const next = new Set(Array.from(prev).filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const start = async (mode: "all" | "selected" | "retry_failed") => {
    setBusy(true);
    try {
      const vins = mode === "selected" ? rows.filter((r) => selected.has(r.id)).map((r) => r._vin) : undefined;
      await callFn(FN.validateStart, { run_id: run.id, mode, selected_vins: vins });
      setSelected(new Set());
      onChanged();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onSave = async (row: VRow, col: WideCol<VRow>, value: string) => {
    await saveEdit(run.id, "vehicle", row.id, { [col.key]: value.trim() === "" ? null : value.trim() });
    onChanged();
    // class code / OCN are recalculated by an event; look again shortly
    setTimeout(onChanged, 2500);
    setTimeout(onChanged, 6000);
  };

  const t = (v?: string | null) => v ?? "";
  const pd = (f: (r: NipValidationResult) => any) => (row: VRow) => (row._res ? (f(row._res) ?? "") : "");

  const cols: WideCol<VRow>[] = [
    {
      key: "vin",
      label: "VIN",
      width: 230,
      editable: true,
      value: (r) => t(r.vin),
      render: (r) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <span>{t(r.vin)}</span>
          {r.is_duplicate ? <Chip size="small" color="warning" label="DUPLICATE" /> : null}
          {r.is_trailer ? <Chip size="small" label="TRAILER" /> : null}
          {!r.is_trailer && r.vin && !isPlaceholderVin(r.vin) && !isValidVin(r.vin) ? <Chip size="small" color="error" label="INVALID VIN" /> : null}
          {!r.is_trailer && r.vin && !vinCheckDigitOk(r.vin) ? (
            <Tooltip title="The 9th character (check digit) does not match the rest of the VIN, so a character was probably misread. Check it against the application.">
              <Chip size="small" color="warning" label="CHECK DIGIT" />
            </Tooltip>
          ) : null}
        </Stack>
      ),
    },
    { key: "make", label: "Make", width: 110, editable: true, value: (r) => t(r.make) },
    { key: "model", label: "Model", width: 130, editable: true, value: (r) => t(r.model) },
    { key: "body_type", label: "Body Type", width: 120, value: (r) => t(r.body_type) },
    { key: "year", label: "Year", width: 80, editable: true, value: (r) => r.year ?? r.year_raw ?? "" },
    { key: "garaging_address", label: "Street Address", width: 200, editable: true, value: (r) => t(r.garaging_address) },
    { key: "garaging_city", label: "City", width: 130, editable: true, value: (r) => t(r.garaging_city) },
    { key: "garaging_state", label: "State", width: 70, editable: true, value: (r) => t(r.garaging_state) },
    { key: "garaging_zip", label: "Zip", width: 90, editable: true, value: (r) => t(r.garaging_zip) },
    { key: "garaging_county", label: "County", width: 130, editable: true, value: (r) => t(r.garaging_county) },
    { key: "radius", label: "Radius", width: 90, editable: true, value: (r) => r.radius ?? r.radius_raw ?? "" },
    {
      key: "cost_new",
      label: "Cost New",
      width: 120,
      align: "right",
      editable: true,
      editValue: (r) => (r.cost_new != null ? String(r.cost_new) : (r.cost_new_raw ?? "")),
      value: (r) => (r.cost_new != null ? fmtMoney(r.cost_new) : (r.cost_new_raw ?? "")),
    },
    {
      key: "status",
      label: "Status",
      width: 200,
      render: (r) => {
        if (r.is_trailer) return "Tabbed app only";
        if (!r._res) return "";
        if (r._res.success) return "OK";
        return r._res.error || "Failed";
      },
    },
    { key: "pd_is_tractor", label: "Is Tractor (PD)", width: 120, value: pd((r) => r.is_tractor) },
    { key: "pd_gvw", label: "GVW (PD)", width: 100, align: "right", value: (r) => fmtNum(r._res?.gross_vehicle_weight) },
    { key: "pd_gcw", label: "GCW (PD)", width: 100, align: "right", value: (r) => fmtNum(r._res?.gross_combine_weight) },
    { key: "pd_ci", label: "Complete/Incomplete (PD)", width: 170, value: pd((r) => r.complete_incomplete) },
    { key: "pd_msrp", label: "MSRP (PD)", width: 110, align: "right", value: (r) => fmtMoney(r._res?.msrp) },
    { key: "pd_retail", label: "Retail Value (PD)", width: 130, align: "right", value: (r) => fmtMoney(r._res?.retail_value) },
    { key: "pd_wholesale", label: "Wholesale Value (PD)", width: 150, align: "right", value: (r) => fmtMoney(r._res?.wholesale_value) },
    { key: "pd_make", label: "Make (PD)", width: 110, value: pd((r) => r.pd_make) },
    { key: "pd_model", label: "Model (PD)", width: 130, value: pd((r) => r.pd_model) },
    { key: "pd_year", label: "Year (PD)", width: 90, value: pd((r) => r.pd_year) },
    { key: "pd_vtype", label: "Vehicle Type (PD)", width: 150, value: pd((r) => r.vehicle_type) },
    { key: "pd_vsub", label: "Vehicle Subtype (PD)", width: 160, value: pd((r) => r.vehicle_subtype) },
    { key: "class_code", label: "Class Code", width: 100, tone: "warning", value: (r) => t(r.class_code) },
    { key: "ocn_value", label: "OCN Value", width: 120, align: "right", tone: "success", value: (r) => fmtMoney(r.ocn_value) },
  ];

  const retryCount = failedRows.length;

  return (
    <Stack spacing={2}>
      <Box
        component="section"
        aria-labelledby="vin-dashboard-title"
        sx={{ p: 2.5, borderRadius: 2, border: 1, borderColor: "divider", bgcolor: (t) => alpha(t.palette.text.primary, 0.02) }}
      >
        <Typography id="vin-dashboard-title" variant="h6" component="h2" sx={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
          VIN Validation Status Dashboard
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
          {skippedRows} rows skipped for blank, invalid, or excluded VINs. Trailer rows use the application values.
          {checkDigitRows.length ? ` ${checkDigitRows.length} VIN${checkDigitRows.length === 1 ? "" : "s"} fail the VIN check digit and may be misread: check them before validating.` : ""}
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1.5} sx={{ mb: 1.5 }}>
          <Stat label="Unique VINs Queued" value={diag.uniqueVinCount ?? diag.validationVinCount ?? 0} />
          <Stat label="Duplicate Rows Skipped" value={diag.duplicateVinCount ?? dup} tint="error" tone="error" />
          <Stat label="Invalid VINs Skipped" value={diag.invalidVinCount ?? 0} tint="warning" tone="warning" />
          <Stat label="Blank / Placeholder Skipped" value={(diag.blankVinCount ?? 0) + (diag.placeholderVinCount ?? 0)} />
          <Stat label="Trailers (Tabbed App Only)" value={trailerRows} />
        </Stack>
        <Stack direction="row" flexWrap="wrap" gap={1.5}>
          <Stat large label="Total Vehicles" value={counted.length} />
          <Stat large label="Passed" value={passed} tone="success" tint="success" icon={<CheckBoxRoundedIcon fontSize="small" color="success" />} />
          <Stat large label="Failed" value={failedRows.length} tone="error" tint="error" icon={<WarningAmberRoundedIcon fontSize="small" color="warning" />} />
          <Stat large label="Pending" value={pending} tone="info" tint="info" icon={<HourglassBottomRoundedIcon fontSize="small" color="warning" />} />
        </Stack>

      {reasons.length > 0 ? (
        <Box aria-labelledby="failure-filters-title" sx={{ mt: 2.5, pt: 2, borderTop: 1, borderColor: "divider" }}>
          <Stack direction="row" alignItems="baseline" gap={1} flexWrap="wrap" sx={{ mb: 1.25 }}>
            <Typography id="failure-filters-title" variant="subtitle2" component="h3" color="text.secondary">
              Failure breakdown &amp; filters
            </Typography>
            <Typography variant="caption" color="text.secondary">
              (Click a pill to filter the vehicle table below)
            </Typography>
          </Stack>
          <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
            {reasons.map(([reason, n]) => {
              const active = reasonFilter === reason;
              return (
                <Chip
                  key={reason}
                  color="error"
                  variant={active || !reasonFilter ? "filled" : "outlined"}
                  aria-pressed={active}
                  onClick={() => setReasonFilter(active ? null : reason)}
                  label={
                    <Stack direction="row" alignItems="center" gap={1} component="span">
                      <span>{reason}</span>
                      <Box
                        component="span"
                        aria-label={`${n} vehicles`}
                        sx={{ minWidth: 22, px: 0.75, borderRadius: 999, textAlign: "center", fontWeight: 700, bgcolor: (t) => alpha(t.palette.common.black, 0.22) }}
                      >
                        {n}
                      </Box>
                    </Stack>
                  }
                  sx={{ height: 34, fontSize: "0.8125rem", textTransform: "none", letterSpacing: 0 }}
                />
              );
            })}
            {reasonFilter ? (
              <Chip
                variant="outlined"
                label="Clear Filter ×"
                onClick={() => setReasonFilter(null)}
                sx={{ height: 34, fontSize: "0.8125rem", textTransform: "none", letterSpacing: 0 }}
              />
            ) : null}
          </Stack>
        </Box>
      ) : null}
      </Box>

      <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
        {canEdit ? (
          <>
            <Button variant="outlined" disabled={busy || running || selected.size === 0} onClick={() => start("selected")}>
              Validate Selected VINs ({selected.size})
            </Button>
            <Button variant="contained" disabled={busy || running || counted.length === 0} onClick={() => start("all")}>
              Validate VINs (PriceDigest)
            </Button>
            {retryCount > 0 && !running ? (
              <Button variant="outlined" color="error" disabled={busy} onClick={() => start("retry_failed")}>
                Retry Failed ({retryCount})
              </Button>
            ) : null}
          </>
        ) : null}
        {running ? (
          <Button variant="text" onClick={onRefresh}>
            Refresh
          </Button>
        ) : null}
        <Box sx={{ flexGrow: 1 }} />
        <FormControlLabel
          control={<Checkbox size="small" checked={hideDup} onChange={(e) => setHideDup(e.target.checked)} />}
          label={`Hide duplicate VINs (${dup})`}
        />
      </Stack>

      {!canEdit && vehicles.length > 0 ? <Alert severity="info">You can view and export this run but not change it.</Alert> : null}

      <WideTable<VRow>
        noun="vehicle rows"
        columns={cols}
        rows={shown}
        rowId={(r) => r.id}
        canEdit={canEdit}
        editingDisabledReason={running ? "Editing disabled during validation" : null}
        onSave={onSave}
        isEdited={(r, c) => edited(r, c.key)}
        selection={
          canEdit
            ? {
                isSelectable: (r) => eligible(r) && !running,
                selected,
                onChange: setSelected,
                disabledTip: "Duplicate, blank, placeholder, or invalid VINs are skipped",
              }
            : undefined
        }
        emptyMessage={<Typography color="text.secondary">{reasonFilter ? "No vehicles match this failure." : "No vehicles to show."}</Typography>}
        rowSx={(r) => (r.is_duplicate ? { opacity: 0.6 } : undefined)}
      />
    </Stack>
  );
};
