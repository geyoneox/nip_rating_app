import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { taruviTokens } from "../theme/themeOptions";

export type StatTone = "primary" | "success" | "warning" | "error" | "info" | "secondary";

export type StatCardProps = {
  /** A `*Rounded` icon element. */
  icon: ReactNode;
  label: string;
  /** `undefined` shows a skeleton while the number loads. */
  value?: number | string;
  tone?: StatTone;
  /** Small line under the number. */
  hint?: string;
  /** Makes the card a button, for example to apply a filter. */
  onClick?: () => void;
  /** Marks the card as the active filter. Only used with `onClick`. */
  selected?: boolean;
};

/** Big bold number with a coloured icon tile. Colours come from the theme palette. */
export const StatCard = ({ icon, label, value, tone = "primary", hint, onClick, selected }: StatCardProps) => {
  const body = (
    <Box
      sx={(t) => ({
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 2,
        width: "100%",
        textAlign: "left",
        p: 2.25,
        borderRadius: `${taruviTokens.radius.xxl}px`,
        border: `1px solid ${selected ? t.palette[tone].main : t.palette.divider}`,
        backgroundColor: selected ? alpha(t.palette[tone].main, 0.08) : t.palette.background.paper,
        boxShadow: selected ? taruviTokens.shadow.raised : taruviTokens.shadow.card,
        overflow: "hidden",
        transition: taruviTokens.transition.base,
        // coloured edge on the left
        "&::before": { content: '""', position: "absolute", left: 0, top: 0, bottom: 0, width: 5, backgroundColor: t.palette[tone].main },
      })}
    >
      <Box
        aria-hidden="true"
        sx={(t) => ({
          flexShrink: 0,
          width: 52,
          height: 52,
          display: "grid",
          placeItems: "center",
          borderRadius: "14px",
          color: t.palette[tone].main,
          backgroundColor: alpha(t.palette[tone].main, 0.14),
          "& .MuiSvgIcon-root": { fontSize: 30 },
        })}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {value === undefined ? (
          <Skeleton variant="text" width={64} height={44} />
        ) : (
          <Typography variant="h2" component="p" sx={{ lineHeight: 1.1 }}>
            {typeof value === "number" ? value.toLocaleString() : value}
          </Typography>
        )}
        <Typography variant="subtitle2" component="p" sx={{ color: "text.secondary" }}>
          {label}
        </Typography>
        {hint ? (
          <Typography variant="caption" component="p" sx={{ color: "text.secondary" }}>
            {hint}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );

  if (!onClick) return body;
  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={Boolean(selected)}
      aria-label={`${label}: ${value ?? "loading"}. Show only these runs.`}
      sx={{
        display: "block",
        width: "100%",
        borderRadius: `${taruviTokens.radius.xxl}px`,
        "&:hover > div": { transform: "translateY(-2px)", boxShadow: taruviTokens.shadow.raised },
      }}
    >
      {body}
    </ButtonBase>
  );
};
