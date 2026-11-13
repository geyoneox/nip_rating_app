/* eslint-disable @typescript-eslint/no-explicit-any */
import { useList } from "@refinedev/core";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { failureReason, pickList } from "../../lib/nip";

/**
 * Read-only counts. Each report is one server-side aggregate query on a single
 * table (no rows are pulled into the browser to be counted).
 */
function Report({ title, resource, groupBy, filters, label, empty }: {
  title: string;
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

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, minWidth: 280, flex: "1 1 320px" }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
      {q?.query?.isError ? (
        <Alert severity="error">This report could not be loaded.</Alert>
      ) : merged.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{empty}</Typography>
      ) : (
        <Table size="small">
          <TableHead><TableRow><TableCell>Group</TableCell><TableCell align="right">Count</TableCell></TableRow></TableHead>
          <TableBody>
            {merged.map((r) => <TableRow key={r.name}><TableCell>{r.name}</TableCell><TableCell align="right">{r.count}</TableCell></TableRow>)}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}

export const UsageReports = () => {
  const progQ: any = useList({ resource: "ref_programs", pagination: { mode: "off" }, queryOptions: { retry: false } } as any);
  const programs: Record<string, string> = {};
  pickList<any>(progQ).forEach((p) => (programs[p.id] = p.name));

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">Read-only counts across all runs.</Typography>
      <Stack direction="row" flexWrap="wrap" gap={2}>
        <Report title="Runs by extraction status" resource="nip_runs" groupBy={["extraction_status"]} label={(r) => r.extraction_status ?? "unknown"} empty="No runs yet." />
        <Report title="Runs by validation status" resource="nip_runs" groupBy={["validation_status"]} label={(r) => r.validation_status ?? "unknown"} empty="No runs yet." />
        <Report title="Runs by day" resource="nip_runs" groupBy={["date_trunc('day', created_at)"]} label={(r) => String(Object.values(r).find((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v as string)) ?? "unknown").slice(0, 10)} empty="No runs yet." />
        <Report title="Runs by program" resource="nip_runs" groupBy={["program_id"]} label={(r) => (r.program_id ? (programs[r.program_id] ?? "Unknown program") : "No program selected")} empty="No runs yet." />
        <Report title="Validation failures by reason" resource="nip_validation_results" groupBy={["error"]} filters={[{ field: "success", operator: "eq", value: false }, { field: "skipped", operator: "eq", value: false }]} label={(r) => failureReason({ error: r.error })} empty="No failed validations." />
        <Report title="Exports by type" resource="nip_exports" groupBy={["export_type"]} label={(r) => String(r.export_type ?? "unknown").replace(/_/g, " ")} empty="No exports yet." />
      </Stack>
    </Stack>
  );
};
