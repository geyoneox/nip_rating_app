/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useList } from "@refinedev/core";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { RISKMETER_REPORTS } from "../../../lib/reportConfig";
import { usePollingInterval } from "../../../lib/usePollingInterval";
import { BUCKETS, FN, callFn, downloadFromBucket, errorMessage, pickList, type NipReport, type NipRun } from "../../../lib/nip";

type Props = {
  run: NipRun;
  type: "riskmeter" | "osha" | "safer";
  canEdit: boolean;
  onError: (m: string) => void;
};

const TITLES = { riskmeter: "RiskMeter", osha: "OSHA", safer: "SAFER" } as const;

export const ReportTab = ({ run, type, canEdit, onError }: Props) => {
  const insuredAddress = [run.insured_mailing_address, run.insured_city, run.insured_state, run.insured_zip].filter(Boolean).join(", ");

  const [address, setAddress] = useState(insuredAddress);
  const [reports, setReports] = useState<string[]>(RISKMETER_REPORTS.map((r) => r.id));
  const [establishment, setEstablishment] = useState(run.insured_name ?? "");
  const [state, setState] = useState(run.insured_state ?? "");
  const [searchBy, setSearchBy] = useState<"usdot" | "name">("usdot");
  const [usdot, setUsdot] = useState("");
  const [company, setCompany] = useState(run.insured_name ?? "");
  const [city, setCity] = useState(run.insured_city ?? "");
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [active, setActive] = useState(false);
  const [key, setKey] = useState("");
  const [tick, setTick] = useState(0);
  const interval = usePollingInterval(active, key, tick);
  const q: any = useList<NipReport>({
    resource: "nip_reports",
    filters: [
      { field: "run_id", operator: "eq", value: run.id },
      { field: "report_type", operator: "eq", value: type },
    ],
    pagination: { currentPage: 1, pageSize: 1 },
    sorters: [{ field: "updated_at", order: "desc" }],
    queryOptions: { refetchInterval: interval as any, retry: false },
  } as any);
  const report = pickList<NipReport>(q)[0];
  const fetchedAt = q?.query?.dataUpdatedAt ?? 0;
  useEffect(() => setTick(fetchedAt), [fetchedAt]);
  const processing = report?.status === "processing";
  // the scraper reports no percentage, so the bar fills over its 10-minute limit and stops at 95%
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!processing) return undefined;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 2000);
    return () => window.clearInterval(t);
  }, [processing]);
  const startedMs = report?.created_at ? new Date(report.created_at.endsWith("Z") ? report.created_at : `${report.created_at}Z`).getTime() : 0;
  const progressPct = processing && now && startedMs ? Math.max(3, Math.min(95, Math.round(((now - startedMs) / 600000) * 100))) : 3;
  useEffect(() => {
    setActive(Boolean(processing));
    setKey(`${report?.status}|${report?.updated_at}`);
  }, [processing, report?.status, report?.updated_at]);

  const extract = async () => {
    setError(null);
    setExtracting(true);
    try {
      const out: any = await callFn(FN.extractAddress, { run_id: run.id });
      if (type === "riskmeter") setAddress(out?.address ?? address);
      if (type === "osha") {
        if (out?.establishment) setEstablishment(out.establishment);
        if (out?.state) setState(String(out.state).slice(0, 2).toUpperCase());
      }
      if (type === "safer" && out?.address) setCity(out?.city ?? city);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExtracting(false);
    }
  };

  const validate = (): string | null => {
    if (type === "riskmeter") {
      if (!address.trim()) return "Enter an insured/location address for RiskMeter.";
      if (reports.length === 0) return "Select at least one RiskMeter report.";
    }
    if (type === "osha") {
      if (!establishment.trim()) return "Enter an establishment name for OSHA.";
      if (!/^[A-Za-z]{2}$/.test(state.trim())) return "Enter a 2-letter state for OSHA.";
    }
    if (type === "safer") {
      if (searchBy === "usdot" && !usdot.trim()) return "Enter a USDOT number for SAFER.";
      if (searchBy === "name" && (!company.trim() || !city.trim() || !/^[A-Za-z]{2}$/.test(state.trim())))
        return "Enter a company name, city and 2-letter state for SAFER.";
    }
    return null;
  };

  const run_ = async () => {
    const v = validate();
    if (v) return setError(v);
    setError(null);
    setBusy(true);
    try {
      const params =
        type === "riskmeter"
          ? { address: address.trim(), reports }
          : type === "osha"
            ? { establishment: establishment.trim(), state: state.trim().toUpperCase() }
            : searchBy === "usdot"
              ? { search_by: "usdot", usdot: usdot.trim() }
              : { search_by: "name", company: company.trim(), city: city.trim(), state: state.trim().toUpperCase() };
      await callFn(FN.reportRun, { run_id: run.id, report_type: type, params });
      await q?.query?.refetch?.();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const download = async (path: string, name: string) => {
    try {
      await downloadFromBucket(BUCKETS.reports, path, name);
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  const files: Array<{ path: string; name: string }> =
    (report?.parameters?.files as any[])?.map((f) => ({ path: f.path ?? f.file_ref, name: f.name ?? "report.pdf" })) ??
    (report?.file_ref ? [{ path: report.file_ref, name: `${TITLES[type]} Report.pdf` }] : []);

  return (
    <Stack spacing={2} sx={{ maxWidth: 760 }}>
      <Typography variant="h6">{TITLES[type]} report</Typography>
      {error ? <Alert severity="error" onClose={() => setError(null)}>{error}</Alert> : null}
      {!canEdit ? <Alert severity="info">You can download finished reports but not order new ones.</Alert> : null}

      {type === "riskmeter" ? (
        <>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              fullWidth
              size="small"
              label="Insured / location address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!canEdit || processing}
              helperText="Defaults from the ACORD insured/applicant address when available; edit before running."
              InputLabelProps={{ shrink: true }}
            />
            {canEdit ? <Button variant="outlined" onClick={extract} disabled={extracting || processing}>{extracting ? "Extracting…" : "Extract"}</Button> : null}
          </Stack>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <div>
              <Typography variant="subtitle1" fontWeight={600}>Reports to order</Typography>
              <Typography variant="body2" color="text.secondary">Based on column B of the RiskMeter workbook.</Typography>
            </div>
            {canEdit ? (
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="outlined" disabled={processing} onClick={() => setReports(RISKMETER_REPORTS.map((r) => r.id))}>Select all</Button>
                <Button size="small" variant="outlined" disabled={processing} onClick={() => setReports([])}>Clear</Button>
              </Stack>
            ) : null}
          </Stack>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }, gap: 1.5 }}>
            {RISKMETER_REPORTS.map((r) => (
              <Box key={r.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, px: 1 }}>
                <FormControlLabel
                  sx={{ m: 0, width: "100%" }}
                  control={<Checkbox size="small" disabled={!canEdit || processing} checked={reports.includes(r.id)} onChange={(e) => setReports(e.target.checked ? [...reports, r.id] : reports.filter((x) => x !== r.id))} />}
                  label={r.label}
                />
              </Box>
            ))}
          </Box>
        </>
      ) : null}

      {type === "osha" ? (
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField fullWidth size="small" label="Establishment / insured name" value={establishment} onChange={(e) => setEstablishment(e.target.value)} disabled={!canEdit} InputLabelProps={{ shrink: true }} />
          <TextField size="small" label="State" value={state} onChange={(e) => setState(e.target.value.slice(0, 2).toUpperCase())} disabled={!canEdit} sx={{ width: 90 }} InputLabelProps={{ shrink: true }} />
          {canEdit ? <Button variant="outlined" onClick={extract} disabled={extracting}>{extracting ? "Extracting…" : "Extract"}</Button> : null}
        </Stack>
      ) : null}

      {type === "safer" ? (
        <Stack spacing={1.5}>
          <TextField select size="small" label="Search By" value={searchBy} onChange={(e) => setSearchBy(e.target.value as any)} disabled={!canEdit} sx={{ maxWidth: 260 }}>
            <MenuItem value="usdot">USDOT Number</MenuItem>
            <MenuItem value="name">Company Name</MenuItem>
          </TextField>
          {searchBy === "usdot" ? (
            <TextField size="small" label="USDOT Number" value={usdot} onChange={(e) => setUsdot(e.target.value.replace(/[^0-9]/g, ""))} disabled={!canEdit} sx={{ maxWidth: 260 }} />
          ) : (
            <Stack direction="row" spacing={1}>
              <TextField fullWidth size="small" label="Company name" value={company} onChange={(e) => setCompany(e.target.value)} disabled={!canEdit} InputLabelProps={{ shrink: true }} />
              <TextField size="small" label="City" value={city} onChange={(e) => setCity(e.target.value)} disabled={!canEdit} InputLabelProps={{ shrink: true }} />
              <TextField size="small" label="State" value={state} onChange={(e) => setState(e.target.value.slice(0, 2).toUpperCase())} disabled={!canEdit} sx={{ width: 90 }} InputLabelProps={{ shrink: true }} />
            </Stack>
          )}
        </Stack>
      ) : null}

      {processing ? (
        <Alert severity="info" icon={<CircularProgress size={18} />}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {TITLES[type]} report is running in a background browser. This view refreshes automatically.
          </Typography>
          <LinearProgress variant="determinate" value={progressPct} />
        </Alert>
      ) : null}

      <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
        {canEdit ? (
          <Button variant="contained" onClick={run_} disabled={busy || processing}>
            {processing
              ? `Running ${TITLES[type]}…`
              : type === "riskmeter"
                ? "Run RiskMeter"
                : type === "osha"
                  ? "Run & Download OSHA Report"
                  : "Run & Download SAFER Report"}
          </Button>
        ) : null}
      </Stack>

      {report?.status === "failed" ? <Alert severity="error">{report.error || "Report generation failed."}</Alert> : null}

      {report?.status === "complete" && files.length > 0 ? (
        <Stack spacing={1}>
          <Typography variant="subtitle2">Downloads</Typography>
          {files.map((f) => (
            <Button key={f.path} variant="outlined" size="small" sx={{ alignSelf: "flex-start" }} onClick={() => download(f.path, f.name)}>
              {type === "osha" && files.length === 1 ? "Download OSHA PDF" : `Download ${f.name}`}
            </Button>
          ))}
          {report.combined_file_ref ? (
            <Button variant="contained" size="small" sx={{ alignSelf: "flex-start" }} onClick={() => download(report.combined_file_ref as string, `${TITLES[type]} Combined Report.pdf`)}>
              Download Combined Report
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
};
