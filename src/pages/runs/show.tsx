/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useList, useOne } from "@refinedev/core";
import { useNavigate, useParams, useSearchParams } from "react-router";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Autocomplete from "@mui/material/Autocomplete";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import BadgeRoundedIcon from "@mui/icons-material/BadgeRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import ConstructionRoundedIcon from "@mui/icons-material/ConstructionRounded";
import DirectionsCarRoundedIcon from "@mui/icons-material/DirectionsCarRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import InventoryRoundedIcon from "@mui/icons-material/InventoryRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import TableChartRoundedIcon from "@mui/icons-material/TableChartRounded";
import VisibilityOffRoundedIcon from "@mui/icons-material/VisibilityOffRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import { AutoTab } from "./tabs/AutoTab";
import { ImTab } from "./tabs/ImTab";
import { DriverTab } from "./tabs/DriverTab";
import { PageHero, StatusChip } from "../../components";
import { usePollingInterval } from "../../lib/usePollingInterval";
import { useNipAccess } from "../../lib/useNipAccess";
import {
  BUCKETS,
  FN,
  callFn,
  openExport,
  pickList,
  fmtDate,
  pickOne,
  saveEdit,
  type NipDriver,
  type NipImItem,
  type NipRun,
  type NipValidationResult,
  type NipVehicle,
} from "../../lib/nip";
import { taruviStorageProvider } from "../../providers/refineProviders";

const TABS = ["auto", "im", "driver"] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABEL: Record<TabKey, string> = { auto: "AUTO", im: "IM", driver: "DRIVER" };
const TAB_ICON: Record<TabKey, ReactElement> = {
  auto: <DirectionsCarRoundedIcon />,
  im: <ConstructionRoundedIcon />,
  driver: <BadgeRoundedIcon />,
};

// Frosted chips for the gradient header.
const HERO_CHIP = {
  bgcolor: "rgba(255,255,255,0.18)",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.4)",
  "& .MuiChip-icon": { color: "#fff" },
} as const;

type ExportKind = "ba" | "im" | "drivers" | "default";
const EXPORT_BUTTONS: Array<{
  kind: ExportKind;
  label: string;
  icon: ReactNode;
  enabled: (c: { hasVehicles: boolean; hasIm: boolean; hasDrivers: boolean }) => boolean;
}> = [
  { kind: "ba", label: "Export BA Worksheet", icon: <DirectionsCarRoundedIcon />, enabled: (c) => c.hasVehicles },
  { kind: "im", label: "Export IM Worksheet", icon: <ConstructionRoundedIcon />, enabled: (c) => c.hasIm },
  { kind: "default", label: "Export Default", icon: <InventoryRoundedIcon />, enabled: (c) => c.hasVehicles || c.hasIm || c.hasDrivers },
  { kind: "drivers", label: "Export Drivers CSV", icon: <BadgeRoundedIcon />, enabled: (c) => c.hasDrivers },
];
const ALL = { pagination: { mode: "off" as const } };
const BATCH_SIZE = 50; // VINs sent to the scraper per request
const STALE_MS = 5 * 60 * 1000;

export const RunShow = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const tab = (TABS.includes(search.get("tab") as TabKey) ? search.get("tab") : "auto") as TabKey;
  const { canEditRun, isReviewer, isAdmin } = useNipAccess();

  const [banner, setBanner] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [showPdf, setShowPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  // ---- polling: read everything from the database so a reload shows the truth ----
  const [active, setActive] = useState(false);
  const [pkey, setPkey] = useState("");
  const [tick, setTick] = useState(0);
  const interval = usePollingInterval(active, pkey, tick);
  const poll = { refetchInterval: interval as any, retry: false };

  const runQ: any = useOne<NipRun>({ resource: "nip_runs", id, queryOptions: poll } as any);
  const run = pickOne<NipRun>(runQ);

  const running = run?.extraction_status === "processing" || run?.validation_status === "processing";
  const progressKey = `${run?.extraction_status}|${JSON.stringify(run?.extraction_progress)}|${run?.validation_status}|${JSON.stringify(run?.validation_progress)}|${run?.last_progress_at}`;
  const fetchedAt = runQ?.query?.dataUpdatedAt ?? 0;
  useEffect(() => {
    setActive(Boolean(running));
    setPkey(progressKey);
  }, [running, progressKey]);
  useEffect(() => setTick(fetchedAt), [fetchedAt]);

  const childPoll = { refetchInterval: running ? (interval as any) : false, retry: false };
  const filterRun = [{ field: "run_id", operator: "eq", value: id }] as any;
  const vehiclesQ: any = useList<NipVehicle>({ resource: "nip_vehicles", filters: filterRun, sorters: [{ field: "row_number", order: "asc" }], ...ALL, queryOptions: childPoll } as any);
  const resultsQ: any = useList<NipValidationResult>({ resource: "nip_validation_results", filters: filterRun, ...ALL, queryOptions: childPoll } as any);
  const imQ: any = useList<NipImItem>({ resource: "nip_im_items", filters: filterRun, sorters: [{ field: "row_number", order: "asc" }], ...ALL, queryOptions: childPoll } as any);
  const driversQ: any = useList<NipDriver>({ resource: "nip_drivers", filters: filterRun, sorters: [{ field: "row_number", order: "asc" }], ...ALL, queryOptions: childPoll } as any);
  const programsQ: any = useList<{ id: string; name: string }>({
    resource: "ref_programs",
    filters: [{ field: "is_active", operator: "eq", value: true }],
    sorters: [{ field: "sort_order", order: "asc" }],
    ...ALL,
    queryOptions: { retry: false },
  } as any);

  const vehicles = pickList<NipVehicle>(vehiclesQ);
  const results = pickList<NipValidationResult>(resultsQ);
  const imItems = pickList<NipImItem>(imQ);
  const drivers = pickList<NipDriver>(driversQ);
  const programs = pickList<{ id: string; name: string }>(programsQ);

  const refreshAll = async () => {
    await Promise.all([runQ?.query?.refetch?.(), vehiclesQ?.query?.refetch?.(), resultsQ?.query?.refetch?.(), imQ?.query?.refetch?.(), driversQ?.query?.refetch?.()]);
  };

  const canEdit = canEditRun(run) && run?.lifecycle_status === "active";
  const validating = run?.validation_status === "processing";
  const extracting = run?.extraction_status === "processing";
  const err = (m: string) => setBanner(m);

  // ---- PDF preview (authenticated download, shown as a blob URL) ----
  useEffect(() => {
    let url: string | null = null;
    let gone = false;
    if (showPdf && run?.source_type === "pdf" && run.file_ref) {
      (taruviStorageProvider as any)
        .getOne({ resource: BUCKETS.uploads, id: run.file_ref, meta: {} })
        .then((res: any) => {
          const d = res?.data;
          if (gone) return;
          if (d instanceof Blob) {
            url = URL.createObjectURL(d);
            setPdfUrl(url);
          } else if (d?.url) setPdfUrl(d.url);
          else err("The PDF could not be shown.");
        })
        .catch(() => !gone && err("The PDF could not be shown."));
    } else setPdfUrl(null);
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPdf, run?.file_ref, run?.source_type]);

  // ---- actions ----
  const setProgram = async (programId: string | null) => {
    if (!run) return;
    try {
      await saveEdit(run.id, "run", run.id, { program_id: programId });
      await callFn(FN.recompute, { run_id: run.id }).catch(() => undefined); // recalculation is best-effort here
      await refreshAll();
    } catch (e: any) {
      err(e.message);
    }
  };

  const doExport = async (kind: ExportKind) => {
    setExporting(kind);
    setBanner(null);
    try {
      const out: any = await callFn(kind === "ba" ? FN.exportBa : kind === "im" ? FN.exportIm : kind === "default" ? FN.exportDefault : FN.exportDrivers, { run_id: id });
      if (out?.warning) setBanner(out.warning);
      await openExport(out);
    } catch (e: any) {
      err(/not found|404|does not exist|no function/i.test(String(e?.message)) ? "This export is not available yet." : e.message);
    } finally {
      setExporting(null);
    }
  };

  const retryExtraction = async () => {
    try {
      await callFn(FN.extractRun, { run_id: id });
      await refreshAll();
    } catch (e: any) {
      err(e.message);
    }
  };

  const stopValidation = async () => {
    try {
      await callFn(FN.validateCancel, { run_id: id });
      await refreshAll();
    } catch (e: any) {
      err(e.message);
    }
  };

  // a running job with no progress for a while: tell the user and offer a manual re-check
  useEffect(() => {
    if (!validating && !extracting) return;
    setNow(new Date().getTime());
    const timer = setInterval(() => setNow(new Date().getTime()), 30000);
    return () => clearInterval(timer);
  }, [validating, extracting]);
  const lastMs = run?.last_progress_at ? new Date(run.last_progress_at).getTime() : 0;
  const stalledMin = (validating || extracting) && lastMs && now && now - lastMs > STALE_MS ? Math.round((now - lastMs) / 60000) : 0;

  const nothingExtracted = run?.extraction_status === "complete" && vehicles.length + imItems.length + drivers.length === 0;
  const progressPct = (p?: { processed: number; total: number } | null) => (p && p.total > 0 ? Math.min(100, Math.round((p.processed / p.total) * 100)) : 0);
  const program = useMemo(() => programs.find((p) => p.id === run?.program_id) ?? null, [programs, run?.program_id]);
  // "12 vehicles" once loaded; just the noun while the query is still running
  const count = (q: any, n: number, noun: string) => (q?.query?.isLoading ? noun : `${n} ${noun}`);
  const tabCount: Record<TabKey, number | null> = {
    auto: vehiclesQ?.query?.isLoading ? null : vehicles.length,
    im: imQ?.query?.isLoading ? null : imItems.length,
    driver: driversQ?.query?.isLoading ? null : drivers.length,
  };

  if (runQ?.query?.isLoading) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!run) {
    return (
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Alert severity="error" action={<Button onClick={() => navigate("/runs")}>Back to Runs</Button>}>
          This run was not found, or you do not have access to it.
        </Alert>
      </Box>
    );
  }
  if (run.lifecycle_status === "deleting") {
    return (
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Alert severity="warning" action={<Button onClick={() => navigate("/runs")}>Back to Runs</Button>}>
          This run is being deleted.
        </Alert>
      </Box>
    );
  }

  const hasVehicles = vehicles.filter((v) => !v.is_duplicate).length > 0;
  const hasIm = imItems.filter((i) => !i.is_small_tool && !i.is_duplicate).length + imItems.filter((i) => i.is_small_tool).length > 0;
  const hasDrivers = drivers.filter((d) => !d.is_duplicate).length > 0;

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2}>
        <PageHero
          icon={run.source_type === "pdf" ? <PictureAsPdfRoundedIcon /> : <TableChartRoundedIcon />}
          title={run.file_name}
          subtitle={`VIN Validation extraction details${run.insured_name ? ` · ${run.insured_name}` : ""}`}
          eyebrow={
            <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate("/runs")}>
              Back to Runs
            </Button>
          }
          meta={
            <>
              <StatusChip run={run} onDark />
              <Chip size="small" icon={<DirectionsCarRoundedIcon />} label={count(vehiclesQ, vehicles.length, "vehicles")} sx={HERO_CHIP} />
              <Chip size="small" icon={<ConstructionRoundedIcon />} label={count(imQ, imItems.length, "IM items")} sx={HERO_CHIP} />
              <Chip size="small" icon={<BadgeRoundedIcon />} label={count(driversQ, drivers.length, "drivers")} sx={HERO_CHIP} />
              <Chip size="small" icon={<CalendarMonthRoundedIcon />} label={fmtDate(run.created_at)} sx={{ ...HERO_CHIP, textTransform: "none" }} />
            </>
          }
          actions={
            run.source_type === "pdf" ? (
              <Button variant="outlined" startIcon={showPdf ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />} onClick={() => setShowPdf((v) => !v)}>
                {showPdf ? "Hide PDF" : "View PDF"}
              </Button>
            ) : null
          }
        />

        <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
          <Stack direction="row" flexWrap="wrap" gap={1.5} alignItems="center">
            <Autocomplete
              size="small"
              sx={{ width: { xs: "100%", sm: 280 } }}
              options={programs}
              value={program}
              disabled={!canEdit || validating || extracting}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              onChange={(_e, v) => setProgram(v ? v.id : null)}
              renderInput={(p) => <TextField {...p} label="Program Name" placeholder="Select program..." InputLabelProps={{ shrink: true }} />}
              noOptionsText="No programs available"
            />
            <Box sx={{ flexGrow: 1 }} />
            {EXPORT_BUTTONS.map((b) => (
              <Button
                key={b.kind}
                variant="outlined"
                startIcon={b.icon}
                disabled={exporting !== null || !b.enabled({ hasVehicles, hasIm, hasDrivers })}
                onClick={() => doExport(b.kind)}
              >
                {exporting === b.kind ? "Exporting…" : b.label}
              </Button>
            ))}
          </Stack>
        </Paper>

        {banner ? (
          <Alert severity="error" onClose={() => setBanner(null)}>
            {banner}
          </Alert>
        ) : null}

        {stalledMin > 0 ? (
          <Alert
            severity="warning"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  setTick(0);
                  refreshAll();
                }}
              >
                Resume checking
              </Button>
            }
          >
            Polling paused. No progress for {stalledMin} minutes, so the provider job may still be running or may have stopped.
          </Alert>
        ) : null}

        {extracting ? (
          <Alert severity="info">
            <AlertTitle>Extraction is in progress. This view will refresh automatically.</AlertTitle>
            <LinearProgress variant={run.extraction_progress?.total ? "determinate" : "indeterminate"} value={progressPct(run.extraction_progress)} sx={{ my: 1 }} />
            {run.extraction_progress?.total ? `${run.extraction_progress.processed}/${run.extraction_progress.total} chunks` : "Starting…"}
          </Alert>
        ) : null}
        {run.extraction_status === "failed" ? (
          <Alert
            severity="error"
            action={
              canEdit ? (
                <Button color="inherit" size="small" onClick={retryExtraction}>
                  Retry Extraction
                </Button>
              ) : undefined
            }
          >
            {run.extraction_error || "Extraction failed."}
          </Alert>
        ) : null}
        {nothingExtracted ? (
          <Alert severity="warning">No data was extracted from this file. Try a different file or confirm the source contains extractable text.</Alert>
        ) : null}
        {validating ? (
          <Alert
            severity="info"
            action={
              canEdit ? (
                <Button color="inherit" size="small" onClick={stopValidation}>
                  Stop Validation
                </Button>
              ) : undefined
            }
          >
            <AlertTitle>VIN validation is running. This view will refresh as results complete.</AlertTitle>
            <LinearProgress variant={run.validation_progress?.total ? "determinate" : "indeterminate"} value={progressPct(run.validation_progress)} sx={{ my: 1 }} />
            {run.validation_progress?.total ? `${run.validation_progress.processed}/${run.validation_progress.total} VINs` : "Starting…"}
          </Alert>
        ) : null}
        {run.validation_status === "cancelled" ? (
          <Alert severity="warning">VIN validation was stopped. Completed results were kept; select VINs to validate again or restart validation.</Alert>
        ) : null}
        {run.validation_status === "failed" ? <Alert severity="error">VIN validation failed. {run.validation_error || "Please try again."}</Alert> : null}

        {showPdf ? (
          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, height: "70vh" }}>
            {pdfUrl ? <iframe title="Uploaded PDF" src={pdfUrl} style={{ width: "100%", height: "100%", border: 0 }} /> : <Box sx={{ p: 3, textAlign: "center" }}><CircularProgress size={24} /></Box>}
          </Box>
        ) : null}

        {run.queue_diagnostics?.validationVinCount ? (
          <Accordion disableGutters variant="outlined">
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} aria-controls="lookup-batches" id="lookup-batches-header">
              <Typography variant="subtitle2">Lookup batches</Typography>
            </AccordionSummary>
            <AccordionDetails id="lookup-batches">
              <Stack spacing={0.5}>
                {Array.from({ length: Math.ceil(run.queue_diagnostics.validationVinCount / BATCH_SIZE) }).map((_x, i) => {
                  const totalVins = run.queue_diagnostics!.validationVinCount;
                  const startAt = i * BATCH_SIZE;
                  const endAt = Math.min(totalVins, startAt + BATCH_SIZE);
                  const done = Math.max(0, (run.validation_progress?.processed ?? 0) - (run.queue_diagnostics!.preservedResultCount ?? 0));
                  const label =
                    done >= endAt
                      ? "Done"
                      : validating
                        ? i === Math.floor(done / BATCH_SIZE)
                          ? "Looking up"
                          : "Waiting"
                        : run.validation_status === "not_started"
                          ? "Not started"
                          : "Not completed";
                  return (
                    <Stack key={i} direction="row" gap={2} alignItems="center">
                      <Typography variant="body2" sx={{ width: 90 }}>
                        Batch {i + 1}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ width: 150 }}>
                        VINs {startAt + 1}-{endAt}
                      </Typography>
                      <Chip
                        size="small"
                        label={label}
                        color={label === "Done" ? "success" : label === "Looking up" ? "info" : "default"}
                        variant={label === "Done" || label === "Looking up" ? "filled" : "outlined"}
                      />
                    </Stack>
                  );
                })}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ) : null}

        <Tabs value={tab} onChange={(_e, v) => setSearch({ tab: v })} variant="scrollable" scrollButtons="auto">
          {TABS.map((t) => (
            <Tab key={t} value={t} icon={TAB_ICON[t]} iconPosition="start" label={tabCount[t] == null ? TAB_LABEL[t] : `${TAB_LABEL[t]} (${tabCount[t]})`} />
          ))}
        </Tabs>

        {tab === "auto" ? (
          <AutoTab run={run} vehicles={vehicles} results={results} canEdit={Boolean(canEdit)} onChanged={refreshAll} onError={err} onRefresh={refreshAll} />
        ) : null}
        {tab === "im" ? (
          <ImTab items={imItems} exportBusy={exporting !== null} onExport={() => doExport("im")} />
        ) : null}
        {tab === "driver" ? (
          <DriverTab run={run} drivers={drivers} canEdit={Boolean(canEdit)} exportBusy={exporting !== null} onExport={() => doExport("drivers")} onChanged={refreshAll} onError={err} />
        ) : null}
      </Stack>
    </Box>
  );
};
