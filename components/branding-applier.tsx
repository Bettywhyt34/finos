"use client";

/**
 * Reads the user's accent-colour preference from localStorage on mount
 * and applies it as --finos-accent on <html>.
 *
 * Appearance (dark/light) is intentionally NOT toggled here.
 * The sidebar and top bar are always dark via --sidebar-bg / --topbar-bg
 * CSS tokens (Dark Pane Mode). Content areas remain light at all times.
 */

import { useEffect } from "react";

const ACCENT_HEX: Record<string, string> = {
  blue:   "#4088f4",
  green:  "#27AE60",
  red:    "#EB5757",
  orange: "#F2994A",
  purple: "#9B51E0",
};

export function BrandingApplier() {
  useEffect(() => {
    const key = localStorage.getItem("finos-accent-color") ?? "blue";
    const hex = ACCENT_HEX[key] ?? ACCENT_HEX.blue;
    document.documentElement.style.setProperty("--finos-accent", hex);
  }, []);

  return null;
}
