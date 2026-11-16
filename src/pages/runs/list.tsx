/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { useList, useMany, useNotification } from "@refinedev/core";
import { useDataGrid } from "@refinedev/mui";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useNavigate } from "react-router";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import ClearRoundedIcon from "@mui/icons-material/ClearRounded";
import DirectionsCarRoundedIcon from "@mui/icons-material/DirectionsCarRounded";
import ErrorRoundedIcon from "@mui/icons-material/ErrorRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import ListAltRoundedIcon from "@mui/icons-material/ListAltRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import SearchOffRoundedIcon from "@mui/icons-material/SearchOffRounded";
import TableChartRoundedIcon from "@mui/icons-material/TableChartRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import FilterAltRoundedIcon from "@mui/icons-material/FilterAltRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { ListPageShell, PagerBar, StatCard, StatusChip } from "../../components";
import { NewValidationModal } from "./NewValidationModal";
import { FN, STATUS_FILTERS, callFn, fmtDate, pickTotal, statusToFilters, type NipRun } from "../../lib/nip";
import { useNipAccess } from "../../lib/useNipAccess";

const PAGE_SIZES = [10, 25, 50, 100];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stable filter arrays, so the stat-card queries keep one query key each.
const ACTIVE = { field: "lifecycle_status", operator: "eq", value: "active" };
const STAT_FILTERS: Record<string, any[]> = {
  total: [ACTIVE],
  extracted: [ACTIVE, ...statusToFilters("Extracted")],
  validating: [ACTIVE, ...statusToFilters("Validating")],
  validated: [ACTIVE, ...statusToFilters("Validated")],
  failed: [ACTIVE, ...statusToFilters("Failed")],
};

/** Live count for one stat card: a one-row server query that only reads the total. */
const useRunCount = (key: keyof typeof STAT_FILTERS): number | undefined => {
  const q: any = useList({
    resource: "nip_runs",
    filters: STAT_FILTERS[key],
    pagination: { currentPage: 1, pageSize: 1 },
    queryOptions: { retry: false },
  } as any);
  if (q?.query?.isError) return 0;
  if (q?.query?.isLoading) return undefined;
  return pickTotal(q);
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

export const RunsList = () => {
  const navigate = useNavigate();
  const { open: notify } = useNotification();
  const { userId, identity, isAdmin, isReviewer, canEditRun } = useNipAccess();
  const counts = {
    total: useRunCount("total"),
    extracted: useRunCount("extracted"),
    validating: useRunCount("validating"),
    validated: useRunCount("validated"),
    failed: useRunCount("failed"),
  };
  const canCreate = !isReviewer || isAdmin; // reviewers cannot upload

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("All Status");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [deleting, setDeleting] = useState<NipRun | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  // debounce the search box (300-500 ms per the guidelines)
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Deleting runs are hidden from the list; search, status and dates become server-side filters.
  const permanent = useMemo(() => {
    const f: any[] = [{ field: "lifecycle_status", operator: "eq", value: "active" }, ...statusToFilters(status)];
    if (search) f.push(UUID.test(search) ? { field: "id", operator: "eq", value: search } : { field: "search", operator: "eq", value: search });
    if (createdFrom) f.push({ field: "created_at", operator: "gte", value: `${createdFrom}T00:00:00` });
    if (createdTo) f.push({ field: "created_at", operator: "lte", value: `${createdTo}T23:59:59` });
    return f;
  }, [search, status, createdFrom, createdTo]);

  const { dataGridProps, tableQuery } = useDataGrid<NipRun>({
    resource: "nip_runs",
    pagination: { pageSize: 25 },
    sorters: { initial: [{ field: "created_at", order: "desc" }] },
    filters: { permanent },
    queryOptions: { retry: false },
  } as any);

  const rawRows = (dataGridProps as any).rows;
  const rows: NipRun[] = useMemo(() => (rawRows ?? []) as NipRun[], [rawRows]);
  const loadError = (tableQuery as any)?.error as any;
  const total: number = (dataGridProps as any).rowCount ?? rows.length;
  const model = (dataGridProps as any).paginationModel ?? { page: 0, pageSize: 25 };
  const setModel = (next: { page: number; pageSize: number }) => (dataGridProps as any).onPaginationModelChange?.(next, {} as any);

  // "Processed by": resolve user names through the user provider (never auth_user). Fails soft.
  const ownerIds = useMemo(() => Array.from(new Set(rows.map((r) => r.owner_id).filter(Boolean))), [rows]);
  const owners = useMany({
    resource: "users",
    dataProviderName: "user",
    ids: ownerIds,
    queryOptions: { enabled: ownerIds.length > 0, retry: false },
  } as any);
  const ownerName = (id: string) => {
    if (id === userId) return identity?.full_name || identity?.username || "You";
    const u: any = ((owners as any).result?.data ?? (owners as any).data?.data ?? []).find((x: any) => String(x.id) === id);
    return u ? u.full_name || [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username : "";
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyDelete(true);
    try {
      await callFn(FN.deleteRun, { run_id: deleting.id });
      notify?.({ type: "success", message: "Run deleted." });
      setDeleting(null);
      await (tableQuery as any)?.refetch?.();
    } catch (e: any) {
      setDeleting(null);
      setBanner(e.message);
      await (tableQuery as any)?.refetch?.();
    } finally {
      setBusyDelete(false);
    }
  };

  const columns = useMemo<GridColDef<NipRun>[]>(
    () => [
      {
        field: "row_no",
        headerName: "#",
        width: 60,
        sortable: false,
        renderCell: (p) => model.page * model.pageSize + (p.api.getRowIndexRelativeToVisibleRows(p.id) ?? 0) + 1,
      },
      {
        field: "open",
        headerName: "",
        width: 110,
        sortable: false,
        renderCell: ({ row }) => (
          <Tooltip title="Open this file to validate more VINs or export again">
            <Button size="small" variant="outlined" startIcon={<FolderOpenRoundedIcon fontSize="small" />} onClick={() => navigate(`/runs/show/${row.id}`)}>
              Open
            </Button>
          </Tooltip>
        ),
      },
      {
        field: "insured_name",
        headerName: "Insured / Company",
        flex: 1,
        minWidth: 190,
        valueGetter: (_v, row) => row.insured_name || "—",
      },
      {
        field: "vin_count",
        headerName: "VIN count",
        width: 100,
        sortable: false,
        align: "right",
        headerAlign: "right",
        renderCell: ({ row }) =>
          row.queue_diagnostics?.totalRows != null ? (
            <Chip size="small" variant="outlined" color="primary" icon={<DirectionsCarRoundedIcon />} label={row.queue_diagnostics.totalRows} />
          ) : (
            "—"
          ),
      },
      {
        field: "file_name",
        headerName: "File",
        flex: 1.6,
        minWidth: 280,
        renderCell: ({ row }) => (
          <Stack direction="row" alignItems="center" gap={1.5} sx={{ minWidth: 0, py: 0.5 }}>
            <Avatar
              variant="rounded"
              aria-hidden="true"
              sx={{ bgcolor: row.source_type === "pdf" ? "error.main" : "success.main", color: "#fff", width: 36, height: 36 }}
            >
              {row.source_type === "pdf" ? <PictureAsPdfRoundedIcon fontSize="small" /> : <TableChartRoundedIcon fontSize="small" />}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Link component="button" underline="hover" sx={{ textAlign: "left", fontWeight: 700 }} onClick={() => navigate(`/runs/show/${row.id}`)}>
                {row.file_name}
              </Link>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: "anywhere" }}>
                {row.file_ref}
              </Typography>
            </Box>
          </Stack>
        ),
      },
      {
        field: "status",
        headerName: "Status",
        width: 130,
        sortable: false,
        renderCell: ({ row }) => <StatusChip run={row} />,
      },
      {
        field: "id",
        headerName: "Run ID",
        width: 300,
        sortable: false,
        renderCell: ({ row }) => (
          <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
            {row.id}
          </Typography>
        ),
      },
      { field: "created_at", headerName: "Created", width: 190, valueGetter: (_v, row) => fmtDate(row.created_at) },
      {
        field: "owner_id",
        headerName: "Processed by",
        width: 180,
        sortable: false,
        renderCell: ({ row }) => {
          const name = ownerName(row.owner_id);
          return name ? (
            <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
              <Avatar aria-hidden="true" sx={{ bgcolor: "secondary.main", color: "#fff", width: 28, height: 28, fontSize: 12 }}>
                {initials(name)}
              </Avatar>
              <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {name}
              </Box>
            </Stack>
          ) : (
            "—"
          );
        },
      },
      {
        field: "actions",
        headerName: "",
        width: 70,
        sortable: false,
        align: "right",
        renderCell: ({ row }) =>
          canEditRun(row) ? (
            <Tooltip title="Delete run">
              <IconButton size="small" aria-label={`Delete ${row.file_name}`} onClick={(e) => { e.stopPropagation(); setDeleting(row); }}>
                <DeleteOutlineRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, canEditRun, owners, userId, identity, model.page, model.pageSize],
  );

  const dateFilters = (createdFrom ? 1 : 0) + (createdTo ? 1 : 0);
  const filtersActive = Boolean(search) || status !== "All Status" || dateFilters > 0;
  const clearAll = () => {
    setSearchInput("");
    setStatus("All Status");
    setCreatedFrom("");
    setCreatedTo("");
  };

  return (
    <ListPageShell
      title="VIN Validation - Runs"
      subtitle="Upload PDFs, extract VIN tables, and validate results."
      icon={<FactCheckRoundedIcon />}
      stats={
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(5, 1fr)" } }}>
          <StatCard icon={<ListAltRoundedIcon />} label="All runs" tone="primary" value={counts.total} selected={status === "All Status"} onClick={() => setStatus("All Status")} />
          <StatCard icon={<TaskAltRoundedIcon />} label="Ready to validate" tone="secondary" value={counts.extracted} selected={status === "Extracted"} onClick={() => setStatus("Extracted")} />
          <StatCard icon={<AutorenewRoundedIcon />} label="Validating" tone="warning" value={counts.validating} selected={status === "Validating"} onClick={() => setStatus("Validating")} />
          <StatCard icon={<VerifiedRoundedIcon />} label="Validated" tone="success" value={counts.validated} selected={status === "Validated"} onClick={() => setStatus("Validated")} />
          <StatCard icon={<ErrorRoundedIcon />} label="Failed" tone="error" value={counts.failed} selected={status === "Failed"} onClick={() => setStatus("Failed")} />
        </Box>
      }
      headerAction={
        canCreate ? (
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setNewOpen(true)}>
            New Validation
          </Button>
        ) : null
      }
      toolbar={
        <>
          <TextField
            size="small"
            placeholder="Search by run ID or file name..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            sx={{ flex: 1, minWidth: { sm: 280 } }}
            inputProps={{ "aria-label": "Search by run ID or file name" }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: searchInput ? (
                <InputAdornment position="end">
                  <IconButton size="small" aria-label="Clear search" onClick={() => setSearchInput("")}>
                    <ClearRoundedIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />
          <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 170 }}>
            {STATUS_FILTERS.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </TextField>
          <Button variant="outlined" startIcon={<FilterAltRoundedIcon />} onClick={(e) => setFilterAnchor(e.currentTarget)}>
            Filters{dateFilters ? ` (${dateFilters})` : ""}
          </Button>
          <Popover
            open={Boolean(filterAnchor)}
            anchorEl={filterAnchor}
            onClose={() => setFilterAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <Stack spacing={2} sx={{ p: 2, width: 280 }}>
              <Typography variant="subtitle2">Created date</Typography>
              <TextField
                size="small"
                type="date"
                label="From"
                value={createdFrom}
                onChange={(e) => setCreatedFrom(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ max: createdTo || undefined }}
              />
              <TextField
                size="small"
                type="date"
                label="To"
                value={createdTo}
                onChange={(e) => setCreatedTo(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: createdFrom || undefined }}
              />
              <Stack direction="row" justifyContent="space-between">
                <Button
                  size="small"
                  disabled={!dateFilters}
                  onClick={() => {
                    setCreatedFrom("");
                    setCreatedTo("");
                  }}
                >
                  Clear dates
                </Button>
                <Button size="small" variant="contained" onClick={() => setFilterAnchor(null)}>
                  Done
                </Button>
              </Stack>
            </Stack>
          </Popover>
        </>
      }
      activeFilters={
        filtersActive ? (
          <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
            {search ? <Chip size="small" label={`Search: ${search}`} onDelete={() => setSearchInput("")} /> : null}
            {status !== "All Status" ? <Chip size="small" label={`Status: ${status}`} onDelete={() => setStatus("All Status")} /> : null}
            {createdFrom ? <Chip size="small" label={`From: ${createdFrom}`} onDelete={() => setCreatedFrom("")} /> : null}
            {createdTo ? <Chip size="small" label={`To: ${createdTo}`} onDelete={() => setCreatedTo("")} /> : null}
            <Button size="small" onClick={clearAll}>
              Clear all
            </Button>
          </Stack>
        ) : null
      }
    >
      {banner ? (
        <Alert severity="error" onClose={() => setBanner(null)} sx={{ mb: 2 }}>
          {banner}
        </Alert>
      ) : null}
      {loadError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError?.statusCode === 403 || loadError?.status === 403
            ? "You do not have permission to view runs."
            : "The runs could not be loaded. Please try again."}
        </Alert>
      ) : null}

      <PagerBar
        total={total}
        page={model.page}
        pageSize={model.pageSize}
        pageSizeOptions={PAGE_SIZES}
        noun="runs"
        onPage={(p) => setModel({ page: p, pageSize: model.pageSize })}
        onPageSize={(n) => setModel({ page: 0, pageSize: n })}
      />

      <DataGrid
        {...dataGridProps}
        columns={columns}
        autoHeight
        hideFooter
        disableRowSelectionOnClick
        onRowClick={(p) => navigate(`/runs/show/${p.id}`)}
        getRowHeight={() => "auto"}
        sx={{ "& .MuiDataGrid-cell": { py: 1, display: "flex", alignItems: "center" }, "& .MuiDataGrid-row": { cursor: "pointer" } }}
        slots={{
          noRowsOverlay: () => (
            <Stack height="100%" alignItems="center" justifyContent="center" spacing={1} sx={{ p: 4 }} role="status">
              <Avatar aria-hidden="true" sx={{ width: 72, height: 72, bgcolor: "primary.main", color: "#fff", mb: 1 }}>
                {filtersActive ? <SearchOffRoundedIcon sx={{ fontSize: 38 }} /> : <FolderOpenRoundedIcon sx={{ fontSize: 38 }} />}
              </Avatar>
              <Typography variant="h5" component="p">{filtersActive ? "No runs match your filters" : "No runs yet"}</Typography>
              <Typography variant="body2" color="text.secondary">
                {filtersActive
                  ? "Try a different search, status or date range."
                  : canCreate
                    ? "Choose New Validation to upload your first application."
                    : "There are no runs to review yet."}
              </Typography>
            </Stack>
          ),
        }}
      />

      <NewValidationModal
        open={newOpen}
        ownerId={userId}
        onClose={() => setNewOpen(false)}
        onCreated={(runId) => {
          setNewOpen(false);
          navigate(`/runs/show/${runId}?tab=auto`);
        }}
      />

      <Dialog open={Boolean(deleting)} onClose={() => !busyDelete && setDeleting(null)}>
        <DialogTitle>Delete run?</DialogTitle>
        <DialogContent>
          <DialogContentText>Delete this VIN run and its uploaded file? This cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)} disabled={busyDelete}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={confirmDelete} disabled={busyDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </ListPageShell>
  );
};
