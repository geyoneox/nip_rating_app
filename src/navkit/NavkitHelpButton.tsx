import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";

const SLOT_ID = "nip-help-slot";

/**
 * Navkit has no prop for extra top-bar buttons, so this places a small slot in its right-hand section, just before
 * the last item (the profile icon), and renders the Help button into it. It takes the colour of the profile icon so
 * it matches the bar. If Navkit re-renders and drops the slot, it is put back.
 */
export const NavkitHelpButton = ({ navRef }: { navRef: RefObject<HTMLDivElement | null> }) => {
  const navigate = useNavigate();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [color, setColor] = useState<string | undefined>(undefined);

  useEffect(() => {
    const root = navRef.current;
    if (!root) return;
    const place = () => {
      const toolbar = root.querySelector(".MuiToolbar-root");
      const right = toolbar?.lastElementChild as HTMLElement | null;
      if (!right) return;
      const profile = Array.from(right.children).filter((c) => c.id !== SLOT_ID).pop() ?? null;
      let el = document.getElementById(SLOT_ID);
      if (!el) {
        el = document.createElement("span");
        el.id = SLOT_ID;
        el.style.display = "inline-flex";
        el.style.alignItems = "center";
      }
      if (el.parentElement !== right || el.nextElementSibling !== profile) right.insertBefore(el, profile);
      const stroke = profile?.querySelector("path")?.getAttribute("stroke");
      if (stroke) setColor(stroke);
      setSlot(el);
    };
    place();
    const obs = new MutationObserver(() => place());
    obs.observe(root, { childList: true, subtree: true });
    return () => {
      obs.disconnect();
      document.getElementById(SLOT_ID)?.remove();
    };
  }, [navRef]);

  if (!slot) return null;
  return createPortal(
    <Tooltip title="Help guide">
      <IconButton aria-label="Open the help guide" size="small" onClick={() => navigate("/help")} sx={{ color: color ?? "inherit", p: 0.5 }}>
        <HelpOutlineRoundedIcon sx={{ fontSize: 25 }} />
      </IconButton>
    </Tooltip>,
    slot,
  );
};
