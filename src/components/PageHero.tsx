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
 * Gradient banner at the top of a page. Every gradient stop clears 4.5:1 against white
 * (see `taruviTokens.gradient`), so the white text and buttons inside stay readable.
 */
export const PageHero = ({ icon, title, subtitle, meta, actions, eyebrow }: PageHeroProps) => (
  <Box
    component="section"
    sx={{
      position: "relative",
      overflow: "hidden",
      color: "#fff",
      borderRadius: `${taruviTokens.radius.xxl}px`,
      backgroundImage: taruviTokens.gradient.hero,
      boxShadow: taruviTokens.shadow.hero,
      px: { xs: 2.5, md: 4 },
      py: { xs: 2.5, md: 3.5 },
    }}
  >
    {/* decorative shapes; hidden from assistive technology */}
    <Box
      aria-hidden="true"
      sx={{ position: "absolute", top: -70, right: -50, width: 240, height: 240, borderRadius: "50%", bgcolor: "rgba(255,255,255,0.08)" }}
    />
    <Box
      aria-hidden="true"
      sx={{ position: "absolute", bottom: -90, right: 140, width: 190, height: 190, borderRadius: "50%", bgcolor: "rgba(255,255,255,0.06)" }}
    />

    <Stack spacing={1.5} sx={{ position: "relative" }}>
      {eyebrow ? (
        <Box
          sx={{
            "& .MuiButton-root": { color: "#fff", px: 0.5 },
            "& .MuiButton-root:hover": { backgroundColor: "rgba(255,255,255,0.14)", color: "#fff" },
          }}
        >
          {eyebrow}
        </Box>
      ) : null}

      <Stack direction="row" flexWrap="wrap" alignItems="center" gap={2.5} justifyContent="space-between">
        <Stack direction="row" alignItems="center" gap={2} sx={{ minWidth: 0, flex: "1 1 320px" }}>
          <Box
            aria-hidden="true"
            sx={{
              flexShrink: 0,
              width: 60,
              height: 60,
              display: "grid",
              placeItems: "center",
              borderRadius: "16px",
              bgcolor: "rgba(255,255,255,0.18)",
              border: "1px solid rgba(255,255,255,0.35)",
              "& .MuiSvgIcon-root": { fontSize: 34 },
            }}
          >
            {icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h2" component="h1" sx={{ color: "#fff", overflowWrap: "anywhere" }}>
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="body1" sx={{ color: "rgba(255,255,255,0.92)", mt: 0.5 }}>
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
          <Stack
            direction="row"
            flexWrap="wrap"
            alignItems="center"
            gap={1.25}
            sx={{
              "& .MuiButton-contained": {
                backgroundImage: "none",
                backgroundColor: "#fff",
                color: taruviTokens.primary[900],
                boxShadow: "0 6px 16px rgba(0,0,0,0.22)",
                "&:hover": { backgroundImage: "none", backgroundColor: taruviTokens.primary[50], boxShadow: "0 10px 22px rgba(0,0,0,0.28)" },
              },
              "& .MuiButton-outlined": {
                color: "#fff",
                borderColor: "rgba(255,255,255,0.85)",
                "&:hover": { color: "#fff", borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.16)" },
              },
            }}
          >
            {actions}
          </Stack>
        ) : null}
      </Stack>
    </Stack>
  </Box>
);
