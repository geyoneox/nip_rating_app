import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

export type PagerBarProps = {
  total: number;
  /** Zero-based page index. */
  page: number;
  /** Rows per page; -1 means "All". */
  pageSize: number;
  pageSizeOptions: number[];
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  /** What is being counted, e.g. "runs" or "vehicle rows". */
  noun: string;
};

/** "Showing 1-25 of 60 runs", rows per page, First / Prev / Page x of y / Next / Last. */
export const PagerBar = ({ total, page, pageSize, pageSizeOptions, onPage, onPageSize, noun }: PagerBarProps) => {
  const all = pageSize === -1;
  const pages = all ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const current = all ? 0 : Math.min(page, pages - 1);
  const from = total === 0 ? 0 : all ? 1 : current * pageSize + 1;
  const to = all ? total : Math.min(total, (current + 1) * pageSize);

  return (
    <Stack
      direction="row"
      flexWrap="wrap"
      alignItems="center"
      justifyContent="space-between"
      gap={1.5}
      sx={{ px: 1.5, py: 1, border: 1, borderColor: "divider", borderRadius: 1, mb: 1.5 }}
    >
      <Typography variant="body2" color="text.secondary" aria-live="polite">
        {total === 0 ? `No ${noun}` : `Showing ${from}-${to} of ${total} ${noun}`}
      </Typography>
      <Stack direction="row" flexWrap="wrap" alignItems="center" gap={1}>
        <Typography variant="body2" color="text.secondary" component="label" htmlFor="pager-rows">
          Rows per page
        </Typography>
        <TextField
          select
          size="small"
          id="pager-rows"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          sx={{ minWidth: 84 }}
          inputProps={{ "aria-label": "Rows per page" }}
        >
          {pageSizeOptions.map((n) => (
            <MenuItem key={n} value={n}>
              {n === -1 ? "All" : n}
            </MenuItem>
          ))}
        </TextField>
        <Button size="small" variant="outlined" disabled={current <= 0} onClick={() => onPage(0)}>
          First
        </Button>
        <Button size="small" variant="outlined" disabled={current <= 0} onClick={() => onPage(current - 1)}>
          Prev
        </Button>
        <Typography variant="body2" sx={{ px: 0.5 }}>
          Page {current + 1} of {pages}
        </Typography>
        <Button size="small" variant="outlined" disabled={current >= pages - 1} onClick={() => onPage(current + 1)}>
          Next
        </Button>
        <Button size="small" variant="outlined" disabled={current >= pages - 1} onClick={() => onPage(pages - 1)}>
          Last
        </Button>
      </Stack>
    </Stack>
  );
};
