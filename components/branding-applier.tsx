"use client";

/**
 * Reads per-browser preferences from localStorage on mount and applies them:
 *   - finos-pane        → sets data-pane="dark"|"light" on <html>
 *   - finos-accent-color → sets --finos-accent CSS variable on <html>
 *
 * Pane mode controls sidebar + topbar colours only.
 * Main content (cards, tables, forms) is always light.
 * The .dark class is never used — no full dark mode.
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

    // Migrate legacy key (finos-appearance → finos-pane)
    const legacy = localStorage.getItem("finos-appearance");
    if (legacy && !localStorage.getItem("finos-pane")) {
      localStorage.setItem("finos-pane", legacy === "light" ? "light" : "dark");
    }
    if (legacy) localStorage.removeItem("finos-appearance");

    // Pane mode — controls sidebar/topbar chrome only
    const pane = localStorage.getItem("finos-pane") ?? "dark";
    root.setAttribute("data-pane", pane === "light" ? "light" : "dark");

    // Accent colour
    const key = localStorage.getItem("finos-accent-color") ?? "blue";
    root.style.setProperty("--finos-accent", ACCENT_HEX[key] ?? ACCENT_HEX.blue);
  }, []);

  return null;
}
