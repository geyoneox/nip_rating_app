/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";
import { useList } from "@refinedev/core";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import ErrorRoundedIcon from "@mui/icons-material/ErrorRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import LayersRoundedIcon from "@mui/icons-material/LayersRounded";
import { failureReason, pickList } from "../../lib/nip";
import { taruviTokens } from "../../theme/themeOptions";

/**
 * Read-only counts. Each report is one server-side aggregate query on a single
 * table (no rows are pulled into the browser to be counted).
 */
function Report({ title, icon, resource, groupBy, filters, label, empty }: {
  title: string;
  icon: ReactNode;
  resource: string;
  groupBy: string[];
  filters?: any[];
  label: (row: any) => string;
  empty: string;
}) {
  const q: any = useList({
    resource,
    filters,
    pagination: { mode: "off" },
    meta: { aggregate: ["count(*)"], groupBy },
    queryOptions: { retry: false },
  } as any);
  const rows = pickList<any>(q).map((r) => ({ name: label(r), count: Number(r.count ?? 0) }));
  // merge rows that map to the same label (e.g. raw error texts grouped into reasons)
  const merged = Object.values(rows.reduce((acc: Record<string, { name: string; count: number }>, r) => {
    acc[r.name] = { name: r.name, count: (acc[r.name]?.count ?? 0) + r.count };
    return acc;
  }, {})).sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...merged.map((r) => r.count));

  return (
    <Paper sx={{ border: 1, borderColor: "divider", p: 2.5, minWidth: 280, flex: "1 1 320px", boxShadow: (t) => (t.palette.mode === "light" ? taruviTokens.shadow.card : taruviTokens.shadow.cardDark) }}>
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ mb: 1.5 }}>
        <Avatar aria-hidden="true" variant="rounded" sx={{ bgcolor: "primary.main", color: "#fff", width: 38, height: 38 }}>{icon}</Avatar>
        <Typography variant="h5" component="h2">{title}</Typography>
      </Stack>
      {q?.query?.isError ? (
        <Alert severity="error">This report could not be loaded.</Alert>
      ) : merged.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{empty}</Typography>
      ) : (
        <Table size="small">
          <TableHead><TableRow><TableCell>Group</TableCell><TableCell align="right">Count</TableCell></TableRow></TableHead>
          <TableBody>
            {merged.map((r) => (
              <TableRow key={r.name}>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{r.name}</Typography>
                  <LinearProgress aria-hidden="true" variant="determinate" value={(r.count / max) * 100} />
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 800, fontSize: "1rem" }}>{r.count.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}

export const UsageReports = () => {
  const progQ: any = useList({ resource: "ref_programs", pagination: { mode: "off" }, queryOptions: { retry: false } } as any);
  const programs: Record<string, string> = {};
  pickList<any>(progQ).forEach((p) => (programs[p.id] = p.name));

  return (
    <Stack spacing={2}>
      <Stack direction="row" flexWrap="wrap" gap={2}>
        <Report icon={<LayersRoundedIcon />} title="Runs by extraction status" resource="nip_runs" groupBy={["extraction_status"]} label={(r) => r.extraction_status ?? "unknown"} empty="No runs yet." />
        <Report icon={<FactCheckRoundedIcon />} title="Runs by validation status" resource="nip_runs" groupBy={["validation_status"]} label={(r) => r.validation_status ?? "unknown"} empty="No runs yet." />
        <Report icon={<CalendarMonthRoundedIcon />} title="Runs by day" resource="nip_runs" groupBy={["date_trunc('day', created_at)"]} label={(r) => String(Object.values(r).find((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v as string)) ?? "unknown").slice(0, 10)} empty="No runs yet." />
        <Report icon={<GroupsRoundedIcon />} title="Runs by program" resource="nip_runs" groupBy={["program_id"]} label={(r) => (r.program_id ? (programs[r.program_id] ?? "Unknown program") : "No program selected")} empty="No runs yet." />
        <Report icon={<ErrorRoundedIcon />} title="Validation failures by reason" resource="nip_validation_results" groupBy={["error"]} filters={[{ field: "success", operator: "eq", value: false }, { field: "skipped", operator: "eq", value: false }]} label={(r) => failureReason({ error: r.error })} empty="No failed validations." />
        <Report icon={<DownloadRoundedIcon />} title="Exports by type" resource="nip_exports" groupBy={["export_type"]} label={(r) => String(r.export_type ?? "unknown").replace(/_/g, " ")} empty="No exports yet." />
      </Stack>
    </Stack>
  );
};
