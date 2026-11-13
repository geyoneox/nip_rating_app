/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useList } from "@refinedev/core";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import { taruviStorageProvider } from "../../providers/refineProviders";
import { BUCKETS, errorMessage, fmtDate, pickList } from "../../lib/nip";

const TEMPLATES = [
  { name: "BA_Worksheet.xlsx", label: "BA Worksheet" },
  { name: "IM_Worksheet.xlsx", label: "IM Worksheet" },
];
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const TemplatesPanel = () => {
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const q: any = useList({
    resource: BUCKETS.templates,
    dataProviderName: "storage",
    pagination: { mode: "off" },
    queryOptions: { retry: false },
  } as any);
  const objs = pickList<any>(q);
  const find = (name: string) => objs.find((o) => (o.path ?? o.file_path) === name || o.filename === name);

  const upload = async (name: string, file: File) => {
    setMsg(null);
    if (!file.name.toLowerCase().endsWith(".xlsx")) return setMsg({ type: "error", text: "Templates must be .xlsx files." });
    if (find(name) && !window.confirm(`Replace the current ${name}? Exports use the new file straight away.`)) return;
    try {
      setBusy(name);
      const blob = new File([file], name, { type: XLSX });
      await (taruviStorageProvider as any).create({ resource: BUCKETS.templates, variables: { files: [blob], paths: [name] }, meta: {} });
      setMsg({ type: "success", text: `${name} uploaded.` });
      await q?.query?.refetch?.();
    } catch (e) {
      setMsg({ type: "error", text: `Upload failed. ${errorMessage(e)}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 640 }}>
      <Typography variant="subtitle1">Excel templates</Typography>
      <Typography variant="body2" color="text.secondary">
        The export functions fill these two files. Names are fixed. Only .xlsx files are accepted.
      </Typography>
      {msg ? <Alert severity={msg.type} onClose={() => setMsg(null)}>{msg.text}</Alert> : null}
      {TEMPLATES.map((t) => {
        const o = find(t.name);
        return (
          <Stack key={t.name} direction="row" spacing={2} alignItems="center" sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
            <Stack sx={{ flexGrow: 1 }}>
              <Typography variant="subtitle2">{t.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                {o ? `${t.name} · uploaded ${fmtDate(o.created_at)}` : `${t.name} · not uploaded yet`}
              </Typography>
            </Stack>
            <Button component="label" variant="outlined" startIcon={<UploadFileRoundedIcon />} disabled={busy !== null}>
              {busy === t.name ? "Uploading…" : o ? "Replace" : "Upload"}
              <input hidden type="file" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(t.name, f); }} />
            </Button>
          </Stack>
        );
      })}
    </Stack>
  );
};
