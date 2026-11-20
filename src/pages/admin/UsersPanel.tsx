/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { useNotification } from "@refinedev/core";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { callFn, errorMessage } from "../../lib/nip";
import { useNipAccess } from "../../lib/useNipAccess";

type UserRow = {
  username: string;
  email: string;
  full_name: string;
  is_active: boolean;
  last_login: string | null;
  date_joined: string | null;
  nip_role: "nip_user" | "nip_reviewer" | "nip_admin" | null;
  is_super_admin: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  nip_user: "User",
  nip_reviewer: "Reviewer",
  nip_admin: "Admin",
};

const FILTERS = [
  { value: "all", label: "Everyone in this app" },
  { value: "super_admin", label: "Super Admin" },
  { value: "nip_admin", label: "Admin" },
  { value: "nip_reviewer", label: "Reviewer" },
  { value: "nip_user", label: "User" },
];

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Never");

/** Lists every person on the tenant. Only a Super Admin may change a role (the function checks it too). */
export const UsersPanel = () => {
  const { isSuperAdmin } = useNipAccess();
  const { open: notify } = useNotification();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ user: UserRow; role: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    callFn<any>("nip_manage_users", { action: "list", search, role, page: page + 1, page_size: size })
      .then((out) => {
        if (cancelled) return;
        setRows(out.users ?? []);
        setTotal(Number(out.total ?? 0));
        setCounts(out.counts ?? {});
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, search, role, page, size, reload]);

  const confirm = useCallback(async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await callFn("nip_manage_users", { action: "set_role", username: pending.user.username, role: pending.role });
      notify?.({ type: "success", message: `${pending.user.username} is now ${ROLE_LABEL[pending.role]}.` });
      setPending(null);
      setReload((n) => n + 1);
    } catch (e) {
      notify?.({ type: "error", message: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }, [pending, notify]);

  if (!isSuperAdmin) {
    return <Alert severity="info">Only a Super Admin can see the people list and change roles.</Alert>;
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", md: "row" }} gap={2} alignItems={{ md: "center" }}>
        <TextField
          size="small"
          label="Search people"
          placeholder="Name, username or email"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          sx={{ minWidth: 300 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon /></InputAdornment> }}
        />
        <TextField select size="small" label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(0); }} sx={{ minWidth: 200 }}>
          {FILTERS.map((f) => (
            <MenuItem key={f.value} value={f.value}>
              {f.label}{f.value === "all" ? ` (${counts.all ?? 0})` : counts[f.value] !== undefined ? ` (${counts[f.value]})` : ""}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {loading ? <LinearProgress aria-label="Loading people" /> : null}

      <TableContainer>
        <Table size="small" aria-label="People and roles">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Last sign-in</TableCell>
              <TableCell>Joined</TableCell>
              <TableCell sx={{ width: 190 }}>NIP role</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.username} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{u.full_name || u.username}</Typography>
                  <Typography variant="caption" color="text.secondary">{u.username}</Typography>
                </TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined" color={u.is_active ? "success" : "default"} label={u.is_active ? "Active" : "Inactive"} />
                </TableCell>
                <TableCell>{fmt(u.last_login)}</TableCell>
                <TableCell>{fmt(u.date_joined)}</TableCell>
                <TableCell>
                  {u.is_super_admin ? (
                    <Chip size="small" color="primary" label="Super Admin" />
                  ) : (
                    <TextField
                      select
                      size="small"
                      fullWidth
                      value={u.nip_role ?? ""}
                      onChange={(e) => e.target.value && e.target.value !== u.nip_role && setPending({ user: u, role: e.target.value })}
                      slotProps={{ select: { displayEmpty: true }, htmlInput: { "aria-label": `NIP role for ${u.username}` } }}
                    >
                      <MenuItem value="" disabled>No NIP role</MenuItem>
                      <MenuItem value="nip_user">User</MenuItem>
                      <MenuItem value="nip_reviewer">Reviewer</MenuItem>
                      <MenuItem value="nip_admin">Admin</MenuItem>
                    </TextField>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                    {search || role !== "all" ? "No one matches these filters." : "No people found."}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page}
        rowsPerPage={size}
        rowsPerPageOptions={[10, 25, 50, 100]}
        onPageChange={(_e, p) => setPage(p)}
        onRowsPerPageChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}
      />

      <Dialog open={Boolean(pending)} onClose={() => !saving && setPending(null)} aria-labelledby="role-dialog-title">
        <DialogTitle id="role-dialog-title">Change role</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Change <b>{pending?.user.full_name || pending?.user.username}</b> from{" "}
            <b>{pending?.user.nip_role ? ROLE_LABEL[pending.user.nip_role] : "No NIP role"}</b> to{" "}
            <b>{pending ? ROLE_LABEL[pending.role] : ""}</b>? It applies the next time they sign in.
            {pending?.role === "nip_admin" ? " Admins can edit reference data and templates and see every run." : ""}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={confirm} disabled={saving}>{saving ? "Saving…" : "Change role"}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};
