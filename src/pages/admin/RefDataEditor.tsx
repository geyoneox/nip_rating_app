/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { useCreate, useDelete, useList, useUpdate } from "@refinedev/core";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TablePagination from "@mui/material/TablePagination";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import { pickList, pickTotal, errorMessage } from "../../lib/nip";

const VEHICLE_TYPES = [
  "All Other", "Extra Heavy Trucks", "Extra Heavy Truck-Tractors", "Heavy Trucks", "Heavy Truck-Tractors", "Light Trucks",
  "Manully Rated Veh", "Medium Trucks", "PPT", "Public Auto", "Semitrailers", "Service or Utility Trailers", "Sp Mobile EQ",
  "Trailers", "ATV/Golf Cart",
];
const CATEGORIES = [
  "mobile_equipment", "semi_trailer", "utility_trailer", "trailer", "tractor_over_45000", "tractor_up_to_45000",
  "truck_45001_plus", "truck_20001_45000", "truck_10001_20000", "truck_up_to_10000", "private_passenger",
];

type FieldDef = {
  key: string;
  label: string;
  kind: "text" | "number" | "int" | "bool" | "select" | "json" | "program";
  required?: boolean;
  options?: string[];
  textual?: boolean; // keep as text (e.g. class codes keep leading zeros)
};

type TableDef = { resource: string; title: string; fields: FieldDef[]; note?: string };

const TABLES: TableDef[] = [
  {
    resource: "ref_programs",
    title: "Programs",
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "is_active", label: "Active", kind: "bool" },
      { key: "sort_order", label: "Sort order", kind: "int" },
    ],
  },
  {
    resource: "ref_ocn_lookup",
    title: "OCN lookup",
    fields: [
      { key: "program_id", label: "Program", kind: "program", required: true },
      { key: "vehicle_type", label: "Vehicle type", kind: "select", options: VEHICLE_TYPES, required: true },
      { key: "avg_cost_new", label: "Average cost new", kind: "number", required: true },
      { key: "avg_model_year", label: "Average model year", kind: "number", required: true },
    ],
  },
  {
    resource: "ref_class_codes",
    title: "Class codes",
    note: "Codes are kept as text so leading zeros stay (for example 03589). Vans use the truck rows. Tractor bands are GCW; truck bands are GVW.",
    fields: [
      { key: "category", label: "Category", kind: "select", options: CATEGORIES, required: true },
      { key: "standard_code", label: "Standard code", kind: "text", required: true, textual: true },
      { key: "special_state_code", label: "Special state code (CA, FL, GA, TX)", kind: "text", required: true, textual: true },
      { key: "dump_standard_code", label: "Dump standard code", kind: "text", required: true, textual: true },
      { key: "dump_special_state_code", label: "Dump special state code (CA, FL, GA, TX)", kind: "text", required: true, textual: true },
      { key: "weight_min", label: "Weight min (GVW; GCW for tractors)", kind: "int" },
      { key: "weight_max", label: "Weight max (blank = no limit)", kind: "int" },
      { key: "notes", label: "Notes", kind: "text" },
    ],
  },
  {
    resource: "ref_rules",
    title: "Rules",
    note: "At least one of the three value fields must be set. Rating keys: dump_sic_codes (text, comma separated, default 79) and deductible_tiers (JSON, limits are inclusive, last tier has no limit, for example [{\"up_to\":50000,\"deductible\":1000},{\"up_to\":100000,\"deductible\":2000},{\"up_to\":null,\"deductible\":5000}]).",
    fields: [
      { key: "rule_key", label: "Rule key", kind: "text", required: true },
      { key: "value_number", label: "Number value", kind: "number" },
      { key: "value_text", label: "Text value", kind: "text" },
      { key: "value_json", label: "JSON value", kind: "json" },
      { key: "description", label: "Description", kind: "text" },
    ],
  },
];

const show = (f: FieldDef, v: any, programs: Record<string, string>) => {
  if (v == null) return "";
  if (f.kind === "bool") return v ? "Yes" : "No";
  if (f.kind === "json") return typeof v === "string" ? v : JSON.stringify(v);
  if (f.kind === "program") return programs[v] ?? String(v).slice(0, 8);
  return String(v);
};

function RefTable({ def, programs }: { def: TableDef; programs: Record<string, string> }) {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [editing, setEditing] = useState<any | null>(null); // row or {} for new
  const [form, setForm] = useState<Record<string, any>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<any | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const q: any = useList({
    resource: def.resource,
    pagination: { currentPage: page + 1, pageSize: size },
    sorters: [{ field: "created_at", order: "desc" }],
    queryOptions: { retry: false },
  } as any);
  const rows = pickList<any>(q);
  const total = pickTotal(q);
  const { mutateAsync: create } = useCreate();
  const { mutateAsync: update } = useUpdate();
  const { mutateAsync: remove } = useDelete();

  const open = (row: any | null) => {
    setFormError(null);
    const init: Record<string, any> = {};
    def.fields.forEach((f) => {
      const v = row?.[f.key];
      init[f.key] = f.kind === "bool" ? (row ? Boolean(v) : true) : f.kind === "json" ? (v == null ? "" : JSON.stringify(v)) : (v ?? "");
    });
    setForm(init);
    setEditing(row ?? {});
  };

  const save = async () => {
    const values: Record<string, any> = {};
    for (const f of def.fields) {
      const raw = form[f.key];
      const empty = raw === "" || raw == null;
      if (f.required && empty) return setFormError(`${f.label} is required.`);
      if (empty) {
        values[f.key] = f.kind === "bool" ? false : null;
        continue;
      }
      if (f.kind === "number" || f.kind === "int") {
        const n = Number(String(raw).replace(/[$,\s]/g, ""));
        if (!Number.isFinite(n)) return setFormError(`${f.label} must be a number.`);
        if (f.kind === "int" && !Number.isInteger(n)) return setFormError(`${f.label} must be a whole number.`);
        values[f.key] = n;
      } else if (f.kind === "json") {
        try { values[f.key] = JSON.parse(String(raw)); } catch { return setFormError(`${f.label} must be valid JSON.`); }
      } else values[f.key] = f.kind === "bool" ? Boolean(raw) : String(raw).trim();
    }
    if (def.resource === "ref_rules" && values.value_number == null && !values.value_text && values.value_json == null)
      return setFormError("Set at least one of the number, text or JSON value.");

    try {
      setSaving(true);
      if (editing?.id) await update({ resource: def.resource, id: editing.id, values: { ...values, updated_at: new Date().toISOString() } });
      else await create({ resource: def.resource, values });
      setEditing(null);
      await q?.query?.refetch?.();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await remove({ resource: def.resource, id: removing.id });
      setRemoving(null);
      await q?.query?.refetch?.();
    } catch (e) {
      setRemoving(null);
      setBanner(
        errorMessage(e).includes("permission")
          ? "You do not have permission to delete this."
          : "This row could not be deleted. It may still be used by other data.",
      );
    }
  };

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>{def.title}</Typography>
        <Button variant="contained" size="small" startIcon={<AddRoundedIcon />} onClick={() => open(null)}>Add</Button>
      </Stack>
      {def.note ? <Typography variant="caption" color="text.secondary">{def.note}</Typography> : null}
      {banner ? <Alert severity="error" onClose={() => setBanner(null)}>{banner}</Alert> : null}
      {q?.query?.isError ? <Alert severity="error">These rows could not be loaded.</Alert> : null}
      <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {def.fields.map((f) => <TableCell key={f.key} sx={{ fontWeight: 600 }}>{f.label}</TableCell>)}
              <TableCell width={96} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={def.fields.length + 1} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No rows yet.</Typography></TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id} hover>
                {def.fields.map((f) => <TableCell key={f.key}>{show(f, r[f.key], programs)}</TableCell>)}
                <TableCell align="right">
                  <IconButton size="small" aria-label="Edit" onClick={() => open(r)}><EditRoundedIcon fontSize="small" /></IconButton>
                  <IconButton size="small" aria-label="Delete" onClick={() => setRemoving(r)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination component="div" count={total} page={page} rowsPerPage={size} rowsPerPageOptions={[10, 25, 50, 100]}
        onPageChange={(_e, p) => setPage(p)} onRowsPerPageChange={(e) => { setSize(Number(e.target.value)); setPage(0); }} />

      <Dialog open={editing !== null} onClose={() => !saving && setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>{editing?.id ? `Edit ${def.title}` : `Add to ${def.title}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {formError ? <Alert severity="error">{formError}</Alert> : null}
            <Alert severity="info">Changes affect new calculations only. Re-run rating on existing runs to apply them.</Alert>
            {def.fields.map((f) =>
              f.kind === "bool" ? (
                <FormControlLabel key={f.key} control={<Switch checked={Boolean(form[f.key])} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} />} label={f.label} />
              ) : f.kind === "select" || f.kind === "program" ? (
                <TextField key={f.key} select size="small" label={f.label} required={f.required} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                  {f.kind === "program"
                    ? Object.entries(programs).map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)
                    : (f.options ?? []).map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                </TextField>
              ) : (
                <TextField key={f.key} size="small" label={f.label} required={f.required} multiline={f.kind === "json"} minRows={f.kind === "json" ? 3 : undefined}
                  value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} InputLabelProps={{ shrink: true }} />
              ),
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(removing)} onClose={() => setRemoving(null)}>
        <DialogTitle>Delete this row?</DialogTitle>
        <DialogContent><DialogContentText>This cannot be undone.</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoving(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmRemove}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export const RefDataEditor = () => {
  const [which, setWhich] = useState(0);
  const progQ: any = useList({ resource: "ref_programs", pagination: { mode: "off" }, queryOptions: { retry: false } } as any);
  const programs = useMemo(() => {
    const m: Record<string, string> = {};
    pickList<any>(progQ).forEach((p) => (m[p.id] = p.name));
    return m;
  }, [progQ]);
  return (
    <Stack spacing={2}>
      <TextField select size="small" label="Table" value={which} onChange={(e) => setWhich(Number(e.target.value))} sx={{ maxWidth: 260 }}>
        {TABLES.map((t, i) => <MenuItem key={t.resource} value={i}>{t.title}</MenuItem>)}
      </TextField>
      <RefTable key={TABLES[which].resource} def={TABLES[which]} programs={programs} />
    </Stack>
  );
};
