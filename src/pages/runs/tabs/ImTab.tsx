/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { WideTable, type WideCol } from "../../../components/WideTable";
import { fmtMoney, saveEdit, type NipImItem, type NipRun } from "../../../lib/nip";

type Props = {
  run: NipRun;
  items: NipImItem[];
  canEdit: boolean;
  exportBusy: boolean;
  onExport: () => void;
  onChanged: () => void;
  editingDisabledReason?: string | null;
};

const VALUATIONS = ["Replacement Cost", "Actual Cash Value"];
const isEdited = (r: NipImItem, key: string) => Boolean(r.edited_fields && r.edited_fields[key]);

export const ImTab = ({ run, items, canEdit, exportBusy, onExport, onChanged, editingDisabledReason }: Props) => {
  const [hideDup, setHideDup] = useState(true);
  const [savingValuation, setSavingValuation] = useState(false);
  const [valuationError, setValuationError] = useState<string | null>(null);

  const shown = useMemo(() => items.filter((i) => !hideDup || !i.is_duplicate), [items, hideDup]);
  const dupCount = items.filter((i) => i.is_duplicate).length;
  const smallTools = items.filter((i) => i.is_small_tool && !i.is_duplicate);
  const largeItems = items.filter((i) => !i.is_small_tool && !i.is_duplicate);
  const total = largeItems.reduce((sum, i) => sum + (i.amount_of_insurance ?? 0), 0);

  const setValuation = async (value: string) => {
    setValuationError(null);
    try {
      setSavingValuation(true);
      await saveEdit(run.id, "run", run.id, { im_valuation_type: value === "" ? null : value });
      onChanged();
    } catch (e: any) {
      setValuationError(e?.message ?? "Could not save.");
    } finally {
      setSavingValuation(false);
    }
  };

  const onSave = async (row: NipImItem, col: WideCol<NipImItem>, value: string) => {
    await saveEdit(run.id, "im_item", row.id, { [col.key]: value.trim() === "" ? null : value.trim() });
    onChanged();
  };

  const cols: WideCol<NipImItem>[] = [
    {
      key: "type",
      label: "Type",
      width: 150,
      editable: true,
      value: (r) => r.type ?? "",
      render: (r) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <span>{r.type ?? ""}</span>
          {r.is_crane ? <Chip size="small" label="CRANE" /> : null}
          {r.is_small_tool ? <Chip size="small" variant="outlined" label="SMALL TOOL" /> : null}
          {r.is_duplicate ? <Chip size="small" color="warning" label="DUPLICATE" /> : null}
        </Stack>
      ),
    },
    { key: "manufacturer", label: "Manufacturer", width: 150, editable: true, value: (r) => r.manufacturer ?? "" },
    { key: "description", label: "Description", width: 240, editable: true, value: (r) => r.description ?? "" },
    { key: "model", label: "Model", width: 140, editable: true, value: (r) => r.model ?? "" },
    { key: "model_year", label: "Year", width: 80, editable: true, value: (r) => r.model_year ?? "" },
    { key: "serial_no", label: "Serial No.", width: 170, editable: true, value: (r) => r.serial_no ?? "" },
    {
      key: "amount_of_insurance",
      label: "Amount of Insurance",
      width: 170,
      align: "right",
      editable: true,
      editValue: (r) => (r.amount_of_insurance != null ? String(r.amount_of_insurance) : (r.amount_of_insurance_raw ?? "")),
      value: (r) => (r.amount_of_insurance != null ? fmtMoney(r.amount_of_insurance) : (r.amount_of_insurance_raw ?? "")),
    },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" flexWrap="wrap" gap={1.5} alignItems="center">
        <TextField
          select
          size="small"
          label="Valuation type"
          value={run.im_valuation_type ?? ""}
          disabled={!canEdit || savingValuation || Boolean(editingDisabledReason)}
          onChange={(e) => setValuation(e.target.value)}
          error={Boolean(valuationError)}
          helperText={valuationError ?? undefined}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">
            <em>Not set</em>
          </MenuItem>
          {VALUATIONS.map((v) => (
            <MenuItem key={v} value={v}>
              {v}
            </MenuItem>
          ))}
        </TextField>
        <Chip label={`Equipment: ${largeItems.length}`} variant="outlined" />
        <Chip label={`Small tools: ${smallTools.length}`} variant="outlined" />
        <Chip label={`Total: ${fmtMoney(total)}`} variant="outlined" />
        <FormControlLabel control={<Checkbox size="small" checked={hideDup} onChange={(e) => setHideDup(e.target.checked)} />} label={`Hide duplicate items (${dupCount})`} />
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" disabled={exportBusy || items.length === 0} onClick={onExport}>
          Export IM Worksheet
        </Button>
      </Stack>

      <WideTable<NipImItem>
        noun="IM items"
        columns={cols}
        rows={shown}
        rowId={(r) => r.id}
        canEdit={canEdit}
        editingDisabledReason={editingDisabledReason}
        onSave={onSave}
        isEdited={(r, c) => isEdited(r, c.key)}
        emptyMessage={<Typography color="text.secondary">No inland marine items extracted.</Typography>}
        rowSx={(r) => (r.is_duplicate ? { opacity: 0.6 } : undefined)}
      />
    </Stack>
  );
};
