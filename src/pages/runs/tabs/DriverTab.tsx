/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { WideTable, type WideCol } from "../../../components/WideTable";
import { saveEdit, type NipDriver, type NipRun } from "../../../lib/nip";

type Props = {
  run: NipRun;
  drivers: NipDriver[];
  canEdit: boolean;
  exportBusy: boolean;
  onExport: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
};



export const DriverTab = ({ run, drivers, canEdit, exportBusy, onExport, onChanged, onError }: Props) => {
  const [hideDup, setHideDup] = useState(true);
  const [meta, setMeta] = useState({ epic_id: run.epic_id ?? "", policy_number: run.policy_number ?? "", broker_email: run.broker_email ?? "" });
  const [savingMeta, setSavingMeta] = useState(false);

  useEffect(() => {
    setMeta({ epic_id: run.epic_id ?? "", policy_number: run.policy_number ?? "", broker_email: run.broker_email ?? "" });
  }, [run.epic_id, run.policy_number, run.broker_email]);

  const shown = useMemo(() => drivers.filter((d) => !hideDup || !d.is_duplicate), [drivers, hideDup]);
  const dupCount = drivers.filter((d) => d.is_duplicate).length;

  const saveMetaField = async (field: "epic_id" | "policy_number" | "broker_email") => {
    const current = (run[field] ?? "") as string;
    if (meta[field].trim() === current) return;
    try {
      setSavingMeta(true);
      await saveEdit(run.id, "run", run.id, { [field]: meta[field].trim() === "" ? null : meta[field].trim() });
      onChanged();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSavingMeta(false);
    }
  };


  const cols: WideCol<NipDriver>[] = [
    { key: "first_name", label: "First name", width: 140, value: (r) => r.first_name ?? "" },
    { key: "middle_name", label: "Middle name", width: 130, value: (r) => r.middle_name ?? "" },
    { key: "last_name", label: "Last name", width: 150, value: (r) => r.last_name ?? "" },
    {
      key: "date_of_birth",
      label: "Date of birth",
      width: 140,
     
      editValue: (r) => r.date_of_birth ?? r.date_of_birth_raw ?? "",
      value: (r) => r.date_of_birth ?? r.date_of_birth_raw ?? "",
    },
    { key: "license_state", label: "Licence state", width: 110, value: (r) => r.license_state ?? "" },
    { key: "license_number", label: "Licence number", width: 170, value: (r) => r.license_number ?? "" },
  ];

  return (
    <Stack spacing={2}>

      <Stack direction="row" flexWrap="wrap" gap={1.5} alignItems="center">
        <TextField size="small" label="Epic ID" value={meta.epic_id} disabled={!canEdit || savingMeta} onChange={(e) => setMeta({ ...meta, epic_id: e.target.value })} onBlur={() => saveMetaField("epic_id")} InputLabelProps={{ shrink: true }} />
        <TextField size="small" label="Policy Number" value={meta.policy_number} disabled={!canEdit || savingMeta} onChange={(e) => setMeta({ ...meta, policy_number: e.target.value })} onBlur={() => saveMetaField("policy_number")} InputLabelProps={{ shrink: true }} />
        <TextField size="small" label="Broker Email" type="email" value={meta.broker_email} disabled={!canEdit || savingMeta} onChange={(e) => setMeta({ ...meta, broker_email: e.target.value })} onBlur={() => saveMetaField("broker_email")} InputLabelProps={{ shrink: true }} sx={{ minWidth: 260 }} />
        <FormControlLabel control={<Checkbox size="small" checked={hideDup} onChange={(e) => setHideDup(e.target.checked)} />} label={`Hide duplicate license numbers (${dupCount})`} />
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" disabled={exportBusy || drivers.length === 0} onClick={onExport}>
          Export Drivers CSV
        </Button>
      </Stack>

      <WideTable<NipDriver>
        columns={cols}
        rows={shown}
        rowId={(r) => r.id}
        emptyMessage={<Typography color="text.secondary">No drivers extracted.</Typography>}
        rowSx={(r) => (r.is_duplicate ? { opacity: 0.6 } : undefined)}
      />
    </Stack>
  );
};
