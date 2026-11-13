import { useMemo, useState } from "react";
import InputAdornment from "@mui/material/InputAdornment";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SearchRounded from "@mui/icons-material/SearchRounded";
import { WideTable, type WideCol } from "../../../components/WideTable";
import type { NipImItem } from "../../../lib/nip";

type Props = {
  items: NipImItem[];
  exportBusy: boolean;
  onExport: () => void;
};

// manufacturer + type + description + model, as the IM worksheet writes it
const describe = (r: NipImItem) => {
  const joined = [r.manufacturer, r.type, r.description, r.model]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return joined || (r.full_description ?? "").trim();
};

const amountText = (r: NipImItem) => (r.amount_of_insurance != null ? String(r.amount_of_insurance) : (r.amount_of_insurance_raw ?? ""));

const COLS: WideCol<NipImItem>[] = [
  { key: "row_number", label: "#", width: 60, value: (r) => r.row_number },
  { key: "description", label: "Description", width: 360, value: describe },
  { key: "model_year", label: "Model Year", width: 140, value: (r) => r.model_year ?? "" },
  { key: "serial_no", label: "ID / Serial No", width: 240, value: (r) => r.serial_no ?? "" },
  { key: "amount_of_insurance", label: "Amount of Insurance", width: 200, value: amountText },
];

export const ImTab = ({ items, exportBusy, onExport }: Props) => {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) => [describe(r), r.model_year ?? "", r.serial_no ?? "", amountText(r)].some((v) => String(v).toLowerCase().includes(q)));
  }, [items, query]);

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" color="success" disabled={exportBusy || items.length === 0} onClick={onExport}>
          Export IM Worksheet
        </Button>
      </Stack>

      <TextField
        size="small"
        placeholder="Filter IM rows by description, year, serial, or amount"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ maxWidth: 440 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchRounded fontSize="small" />
            </InputAdornment>
          ),
        }}
      />

      <WideTable<NipImItem>
        noun="IM rows"
        columns={COLS}
        rows={shown}
        rowId={(r) => r.id}
        emptyMessage={<Typography color="text.secondary">No inland marine items extracted.</Typography>}
      />
    </Stack>
  );
};
