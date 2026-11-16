import type { ReactNode } from "react";
import { CreateButton } from "@refinedev/mui";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import { PageHero } from "./PageHero";
import { taruviTokens } from "../theme/themeOptions";

/**
 * The standard list-page shell.
 *
 * A gradient hero (icon, title, primary action), an optional row of stat cards, then
 * **one** card holding the toolbar row, the active-filter chip row and the rows.
 * `ThemedLayout` is `p: 0` in this template, so the page padding lives here.
 */
export type ListPageShellProps = {
  /** Page heading. Rendered as the page's only H1. */
  title: string;
  /** One line under the heading, e.g. what the page is for. */
  subtitle?: string;
  /** A `*Rounded` icon element for the hero. */
  icon?: ReactNode;
  /** Custom primary action (for example a button that opens a dialog). Used instead of createLabel. */
  headerAction?: ReactNode;
  /** Label for the primary create action. Omit to render no create button. */
  createLabel?: string;
  /** Stat cards shown between the hero and the list card. */
  stats?: ReactNode;
  /** Search input and filter controls. Placed in the standard toolbar row. */
  toolbar: ReactNode;
  /** Active-filter chip row. Render `null` when no filter is set. */
  activeFilters?: ReactNode;
  /** The grid or list body, including its own empty and loading states. */
  children: ReactNode;
};

export const ListPageShell = ({
  title,
  subtitle,
  icon,
  headerAction,
  createLabel,
  stats,
  toolbar,
  activeFilters,
  children,
}: ListPageShellProps) => (
  <Box sx={{ p: { xs: 2, md: 3 } }}>
    <Stack spacing={2.5}>
      <PageHero
        icon={icon ?? <FolderOpenRoundedIcon />}
        title={title}
        subtitle={subtitle}
        actions={
          headerAction ??
          (createLabel ? (
            <CreateButton variant="contained" startIcon={<AddRoundedIcon />}>
              {createLabel}
            </CreateButton>
          ) : null)
        }
      />

      {stats}

      <Paper
        sx={{
          p: { xs: 2, md: 3 },
          border: 1,
          borderColor: "divider",
          boxShadow: (t) => (t.palette.mode === "light" ? taruviTokens.shadow.card : taruviTokens.shadow.cardDark),
        }}
      >
        {/* A row from `sm` up, so the search box can take its width at the same breakpoint. */}
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems={{ xs: "stretch", sm: "center" }}
          sx={{ mb: 2, flexWrap: "wrap", rowGap: 1.5 }}
        >
          {toolbar}
        </Stack>

        {activeFilters ? <Box sx={{ mb: 1.5 }}>{activeFilters}</Box> : null}

        {children}
      </Paper>
    </Stack>
  </Box>
);
