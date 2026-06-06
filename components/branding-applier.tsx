"use client";

/**
 * Reads branding preferences from localStorage on mount and applies them:
 *   - appearance  → toggles `dark` class on <html>
 *   - accent-color → sets --finos-accent CSS variable on <html>
 *
 * Mounted once in the root layout. Zero render output.
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
    const root = document.documentElement;

    // ── Appearance ────────────────────────────────────────────────────────────
    const appearance = localStorage.getItem("finos-appearance");
    if (appearance === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // ── Accent colour ─────────────────────────────────────────────────────────
    const key = localStorage.getItem("finos-accent-color") ?? "blue";
    const hex = ACCENT_HEX[key] ?? ACCENT_HEX.blue;
    root.style.setProperty("--finos-accent", hex);
  }, []);

  return null;
}
