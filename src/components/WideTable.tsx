/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { PagerBar } from "./PagerBar";

export type WideCol<T> = {
  key: string;
  label: string;
  width?: number;
  align?: "left" | "right";
  editable?: boolean;
  /** Text shown in the editor (defaults to value()). */
  editValue?: (row: T) => string;
  value?: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
};

export type Selection<T> = {
  isSelectable: (row: T) => boolean;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabledTip: string;
};

type Props<T> = {
  columns: WideCol<T>[];
  rows: T[];
  rowId: (row: T) => string;
  onSave?: (row: T, col: WideCol<T>, value: string) => Promise<void>;
  /** When set, cells are not editable and this text explains why (shown as a tooltip). */
  editingDisabledReason?: string | null;
  /** True when the user may edit at all (reviewers: false, no tooltip). */
  canEdit?: boolean;
  isEdited?: (row: T, col: WideCol<T>) => boolean;
  selection?: Selection<T>;
  defaultPageSize?: number;
  pageSizeOptions?: Array<number | { value: number; label: string }>;
  emptyMessage?: ReactNode;
  maxHeight?: number | string;
  rowSx?: (row: T) => any;
  loading?: boolean;
  /** What the pager counts, e.g. "vehicle rows". */
  noun?: string;
};

export function WideTable<T>({
  columns,
  rows,
  rowId,
  onSave,
  editingDisabledReason,
  canEdit = true,
  isEdited,
  selection,
  defaultPageSize = 40,
  pageSizeOptions = [40, 100, 250, { value: -1, label: "All" }],
  emptyMessage = "No rows",
  maxHeight = "65vh",
  rowSx,
  loading,
  noun = "rows",
}: Props<T>) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);
  const cancelled = useRef(false);

  // --- top + bottom horizontal scrollbars kept in sync ---
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollW, setScrollW] = useState(0);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const update = () => setScrollW(el.scrollWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [rows.length, columns.length, pageSize, page]);

  const syncing = useRef(false);
  const onTopScroll = () => {
    if (syncing.current) return (syncing.current = false);
    if (bodyRef.current && topRef.current) {
      syncing.current = true;
      bodyRef.current.scrollLeft = topRef.current.scrollLeft;
    }
  };
  const onBodyScroll = () => {
    if (syncing.current) return (syncing.current = false);
    if (bodyRef.current && topRef.current) {
      syncing.current = true;
      topRef.current.scrollLeft = bodyRef.current.scrollLeft;
    }
  };

  useEffect(() => {
    // stay on a valid page when rows shrink (e.g. a filter was applied)
    const max = pageSize === -1 ? 0 : Math.max(0, Math.ceil(rows.length / pageSize) - 1);
    if (page > max) setPage(max);
  }, [rows.length, pageSize, page]);

  const visible = pageSize === -1 ? rows : rows.slice(page * pageSize, page * pageSize + pageSize);
  const offset = pageSize === -1 ? 0 : page * pageSize;

  const startEdit = (row: T, col: WideCol<T>) => {
    if (!col.editable || !canEdit || editingDisabledReason || !onSave) return;
    const initial = col.editValue ? col.editValue(row) : String(col.value?.(row) ?? "");
    cancelled.current = false;
    setCellError(null);
    setDraft(initial);
    setEditing({ id: rowId(row), key: col.key });
  };

  const commit = async (row: T, col: WideCol<T>) => {
    if (cancelled.current || !onSave) return;
    const initial = col.editValue ? col.editValue(row) : String(col.value?.(row) ?? "");
    if (draft === initial) return setEditing(null);
    try {
      setSaving(true);
      await onSave(row, col, draft);
      setEditing(null);
    } catch (e: any) {
      setCellError(e?.message ?? "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const selectableRows = selection ? rows.filter(selection.isSelectable) : [];
  const allSelected =
    selection && selectableRows.length > 0 && selectableRows.every((r) => selection.selected.has(rowId(r)));
  const someSelected = selection && selectableRows.some((r) => selection.selected.has(rowId(r)));

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allSelected) selectableRows.forEach((r) => next.delete(rowId(r)));
    else selectableRows.forEach((r) => next.add(rowId(r)));
    selection.onChange(next);
  };

  const sizes = (pageSizeOptions as Array<number | { value: number; label: string }>).map((o) => (typeof o === "number" ? o : o.value));

  return (
    <Box>
      <PagerBar
        total={rows.length}
        page={page}
        pageSize={pageSize}
        pageSizeOptions={sizes}
        noun={noun}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n);
          setPage(0);
        }}
      />
      <Box ref={topRef} onScroll={onTopScroll} sx={{ overflowX: "auto", overflowY: "hidden", height: 14 }} aria-hidden>
        <Box sx={{ width: scrollW, height: 1 }} />
      </Box>
      <TableContainer ref={bodyRef} onScroll={onBodyScroll} sx={{ maxHeight, border: 1, borderColor: "divider", borderRadius: 1 }}>
        <Table stickyHeader size="small" sx={{ minWidth: "max-content" }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 48, minWidth: 48 }}>#</TableCell>
              {selection ? (
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={Boolean(allSelected)}
                    indeterminate={Boolean(someSelected && !allSelected)}
                    onChange={toggleAll}
                    inputProps={{ "aria-label": "Select all eligible rows" }}
                  />
                </TableCell>
              ) : null}
              {columns.map((c) => (
                <TableCell key={c.key} align={c.align} sx={{ minWidth: c.width ?? 120, whiteSpace: "nowrap", fontWeight: 600 }}>
                  {c.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1 + (selection ? 1 : 0)} align="center" sx={{ py: 5 }}>
                  {loading ? <Typography color="text.secondary">Loading…</Typography> : emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row, i) => {
                const id = rowId(row);
                const selectable = selection?.isSelectable(row) ?? false;
                return (
                  <TableRow key={id} hover sx={rowSx?.(row)}>
                    <TableCell>{offset + i + 1}</TableCell>
                    {selection ? (
                      <TableCell padding="checkbox">
                        <Tooltip title={selectable ? "" : selection.disabledTip}>
                          <span>
                            <Checkbox
                              size="small"
                              disabled={!selectable}
                              checked={selection.selected.has(id)}
                              onChange={() => {
                                const next = new Set(selection.selected);
                                if (next.has(id)) next.delete(id);
                                else next.add(id);
                                selection.onChange(next);
                              }}
                              inputProps={{ "aria-label": `Select row ${offset + i + 1}` }}
                            />
                          </span>
                        </Tooltip>
                      </TableCell>
                    ) : null}
                    {columns.map((col) => {
                      const isEditing = editing?.id === id && editing.key === col.key;
                      const edited = isEdited?.(row, col);
                      const editable = Boolean(col.editable && canEdit && onSave);
                      const content = col.render ? col.render(row) : (col.value?.(row) ?? "");
                      return (
                        <TableCell
                          key={col.key}
                          align={col.align}
                          onClick={() => !isEditing && startEdit(row, col)}
                          sx={(t) => ({
                            whiteSpace: "nowrap",
                            cursor: editable && !editingDisabledReason ? "text" : "default",
                            bgcolor: edited ? alpha(t.palette.warning.main, 0.16) : undefined,
                          })}
                        >
                          {isEditing ? (
                            <TextField
                              autoFocus
                              size="small"
                              variant="standard"
                              value={draft}
                              disabled={saving}
                              error={Boolean(cellError)}
                              helperText={cellError ?? undefined}
                              onChange={(e) => setDraft(e.target.value)}
                              onFocus={(e) => e.target.select()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commit(row, col);
                                } else if (e.key === "Escape") {
                                  cancelled.current = true;
                                  setEditing(null);
                                }
                              }}
                              onBlur={() => !saving && (cancelled.current ? undefined : commit(row, col))}
                              inputProps={{ "aria-label": col.label }}
                            />
                          ) : col.editable && canEdit && editingDisabledReason ? (
                            <Tooltip title={editingDisabledReason}>
                              <span>{content as ReactNode}</span>
                            </Tooltip>
                          ) : (
                            (content as ReactNode)
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

    </Box>
  );
}
