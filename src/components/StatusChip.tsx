import type { ReactElement } from "react";
import Chip from "@mui/material/Chip";
import { keyframes } from "@mui/material/styles";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import ErrorRoundedIcon from "@mui/icons-material/ErrorRounded";
import HourglassTopRoundedIcon from "@mui/icons-material/HourglassTopRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import { runStatus, type NipRun, type RunStatusLabel } from "../lib/nip";

const spin = keyframes`from { transform: rotate(0deg); } to { transform: rotate(360deg); }`;

const ICONS: Record<RunStatusLabel, ReactElement> = {
  Validating: <AutorenewRoundedIcon />,
  Cancelled: <BlockRoundedIcon />,
  Failed: <ErrorRoundedIcon />,
  Validated: <VerifiedRoundedIcon />,
  Extracted: <TaskAltRoundedIcon />,
  Processing: <HourglassTopRoundedIcon />,
};

/** The run status as a chip with an icon. The text label always stays, so colour is never the only signal. */
export const StatusChip = ({
  run,
  size = "small",
  onDark = false,
}: {
  run: Pick<NipRun, "extraction_status" | "validation_status">;
  size?: "small" | "medium";
  /** White chip with a coloured label, for use on the gradient page header. */
  onDark?: boolean;
}) => {
  const s = runStatus(run);
  const tone = s.color === "default" ? "primary" : s.color;
  return (
    <Chip
      size={size}
      icon={ICONS[s.label]}
      label={s.label}
      color={s.color}
      variant={s.color === "default" && !onDark ? "outlined" : "filled"}
      sx={[
        onDark && {
          backgroundColor: "#fff",
          color: (t) => t.palette[tone].dark,
          "& .MuiChip-icon": { color: "inherit" },
        },
        s.label === "Validating" && {
          "& .MuiChip-icon": { "@media (prefers-reduced-motion: no-preference)": { animation: `${spin} 1.4s linear infinite` } },
        },
      ]}
    />
  );
};
