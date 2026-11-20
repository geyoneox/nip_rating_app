import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import type { ExtractionSummary as Summary } from "../../lib/nip";

const TAB_LABEL: Record<string, string> = { AUTO: "Vehicles", IM: "Equipment (IM)", DRIVER: "Drivers" };

const minutes = (s?: number) => (s == null ? "" : s < 90 ? `${s} s` : `${Math.round(s / 6) / 10} min`);

/** What the extraction read: which version of each section was kept, timing, clean-up and any unread pages. */
export const ExtractionSummary = ({ summary }: { summary?: Summary | null }) => {
  if (!summary || summary.seconds == null) return null;
  const warnings = summary.warnings ?? [];
  const choices = summary.choices ?? {};
  const pages = (summary.passes ?? []).reduce((n, p) => n + (p.pages ?? 0), 0);
  return (
    <Stack spacing={1.5}>
      {warnings.length ? (
        <Alert severity="warning">
          <AlertTitle>Extraction finished, but some pages could not be read</AlertTitle>
          {warnings.map((w, i) => (
            <Typography key={i} variant="body2">
              Pages {w.pages} ({w.pass}): {w.reason}
            </Typography>
          ))}
        </Alert>
      ) : null}
      {summary.mock ? <Alert severity="info">Sample data: no Gemini key is set, so the extraction returned a fixed test result.</Alert> : null}
      <Accordion disableGutters variant="outlined">
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} aria-controls="extraction-summary" id="extraction-summary-header">
          <Typography variant="subtitle1">
            Extraction read {pages} pages in {summary.total} parts in {minutes(summary.seconds)}
          </Typography>
        </AccordionSummary>
        <AccordionDetails id="extraction-summary">
          <Stack spacing={1}>
            {Object.keys(choices).map((tab) => {
              const c = choices[tab];
              return (
                <Stack key={tab} direction="row" gap={1} alignItems="center" flexWrap="wrap">
                  <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 130 }}>{TAB_LABEL[tab] ?? tab}</Typography>
                  <Chip size="small" color="primary" variant="outlined" label={c.chosen === "revised" ? "Revised kept" : "Base kept"} />
                  <Typography variant="body2">
                    {c.rows} rows from {(c.chosen_titles ?? []).join(", ")}
                    {c.other ? `; the ${c.other} version (${(c.other_titles ?? []).join(", ")}) had ${c.other_rows} rows` : ""}
                  </Typography>
                </Stack>
              );
            })}
            {summary.cleanup ? (
              <Typography variant="body2" color="text.secondary">
                Clean-up: {summary.cleanup.vin_fixed ?? 0} VINs corrected (O to 0, I to 1), {summary.cleanup.stated_cleared ?? 0} stated amounts that equalled a deductible cleared,{" "}
                {summary.cleanup.garaging_from_premises ?? 0} garaging addresses filled from the premises list ({summary.premises?.length ?? 0} premises found).
              </Typography>
            ) : null}
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
};
