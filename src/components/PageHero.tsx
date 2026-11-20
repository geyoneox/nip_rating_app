import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { taruviTokens } from "../theme/themeOptions";

export type PageHeroProps = {
  /** A `*Rounded` icon element. Shown in a frosted tile to the left of the title. */
  icon: ReactNode;
  /** The page's only H1. */
  title: string;
  subtitle?: ReactNode;
  /** Chips or small facts shown under the subtitle. */
  meta?: ReactNode;
  /** Buttons on the right. Contained buttons turn white, outlined ones get a white outline. */
  actions?: ReactNode;
  /** Something small above the title, such as a Back button. */
  eyebrow?: ReactNode;
};

/**
 * Page header: a flat white card with an upper-case title on the left and the page actions on
 * the right, like the reference screenshot. Colours come from the theme, so contrast follows it.
 */
export const PageHero = ({ icon, title, subtitle, meta, actions, eyebrow }: PageHeroProps) => (
  <Box
    component="section"
    sx={{
      bgcolor: "background.paper",
      borderRadius: `${taruviTokens.radius.xxl}px`,
      boxShadow: taruviTokens.shadow.card,
      px: { xs: 2.5, md: 4 },
      py: { xs: 2.5, md: 3 },
    }}
  >
    <Stack spacing={1.5}>
      {eyebrow ? <Box>{eyebrow}</Box> : null}

      <Stack direction="row" flexWrap="wrap" alignItems="center" gap={2.5} justifyContent="space-between">
        <Stack direction="row" alignItems="center" gap={1.5} sx={{ minWidth: 0, flex: "1 1 320px" }}>
          <Box aria-hidden="true" sx={{ flexShrink: 0, display: "grid", placeItems: "center", color: "primary.main", "& .MuiSvgIcon-root": { fontSize: 30 } }}>
            {icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="h2"
              component="h1"
              sx={{ fontSize: "1.5rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "text.primary", overflowWrap: "anywhere" }}
            >
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                {subtitle}
              </Typography>
            ) : null}
            {meta ? (
              <Stack direction="row" flexWrap="wrap" alignItems="center" gap={1} sx={{ mt: 1.5 }}>
                {meta}
              </Stack>
            ) : null}
          </Box>
        </Stack>

        {actions ? (
          <Stack direction="row" flexWrap="wrap" alignItems="center" gap={1.25}>
            {actions}
          </Stack>
        ) : null}
      </Stack>
    </Stack>
  </Box>
);