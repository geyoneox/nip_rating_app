import { Fragment, useEffect, useState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import { PageHero } from "../../components";

/** The guide lives in public/help so it can also be opened and edited as a plain file. */
export const HELP_GUIDE_URL = "/help/help-guide.md";

/** **bold**, `code` and plain text. Builds elements, never HTML, so the guide cannot inject markup. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("**") ? <strong key={k++}>{tok.slice(2, -2)}</strong> : <code key={k++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type ListItem = { text: string; children: string[] };

/** The subset of Markdown the guide uses: headings, paragraphs, images, lists (one nested level) and tables. */
function renderGuide(md: string): ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(
        <Typography key={key++} variant={level === 1 ? "h3" : level === 2 ? "h4" : "h5"} component={`h${level + 1}` as "h2"} sx={{ mt: level === 1 ? 0 : 3, mb: 1 }}>
          {inline(h[2])}
        </Typography>,
      );
      i++;
      continue;
    }
    const img = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
    if (img) {
      out.push(
        <Box key={key++} component="figure" sx={{ m: 0, my: 2 }}>
          <Box component="img" src={img[2]} alt={img[1]} loading="lazy" sx={{ width: "100%", maxWidth: 1000, display: "block", border: 1, borderColor: "divider", borderRadius: 1 }} />
          <Typography component="figcaption" variant="caption" color="text.secondary">{img[1]}</Typography>
        </Box>,
      );
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i].split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <TableContainer key={key++} sx={{ my: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>{head.map((c, j) => <TableCell key={j}>{inline(c)}</TableCell>)}</TableRow>
            </TableHead>
            <TableBody>
              {body.map((r, n) => (
                <TableRow key={n}>{r.map((c, j) => <TableCell key={j}>{inline(c)}</TableCell>)}</TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>,
      );
      continue;
    }
    const listRe = /^(\d+\.|-)\s+(.*)$/;
    if (listRe.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items: ListItem[] = [];
      while (i < lines.length && (listRe.test(lines[i]) || /^\s{2,}-\s+/.test(lines[i]))) {
        const sub = /^\s{2,}-\s+(.*)$/.exec(lines[i]);
        if (sub && items.length) items[items.length - 1].children.push(sub[1]);
        else items.push({ text: (listRe.exec(lines[i]) as RegExpExecArray)[2], children: [] });
        i++;
      }
      out.push(
        <Box key={key++} component={ordered ? "ol" : "ul"} sx={{ pl: 3, my: 1 }}>
          {items.map((it, n) => (
            <Typography key={n} component="li" variant="body1" sx={{ mb: 0.5 }}>
              {inline(it.text)}
              {it.children.length ? (
                <Box component="ul" sx={{ pl: 3, mt: 0.5 }}>
                  {it.children.map((c, j) => <Typography key={j} component="li" variant="body1">{inline(c)}</Typography>)}
                </Box>
              ) : null}
            </Typography>
          ))}
        </Box>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|!\[|\||\d+\.\s|-\s)/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(<Typography key={key++} variant="body1" sx={{ my: 1 }}>{inline(para.join(" "))}</Typography>);
  }
  return out;
}

export const HelpPage = () => {
  const [md, setMd] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(HELP_GUIDE_URL)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => alive && setMd(t))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2.5}>
        <PageHero icon={<HelpOutlineRoundedIcon />} title="Help guide" subtitle="How to upload an application, validate VINs, correct values and export the worksheets." />
        <Paper sx={{ p: { xs: 2, md: 4 }, border: 1, borderColor: "divider" }}>
          {error ? <Alert severity="error">The help guide could not be loaded. Please refresh the page.</Alert> : null}
          {!md && !error ? <LinearProgress aria-label="Loading the help guide" /> : null}
          {md ? <Fragment>{renderGuide(md.replace(/^# .*\n/, ""))}</Fragment> : null}
        </Paper>
      </Stack>
    </Box>
  );
};
