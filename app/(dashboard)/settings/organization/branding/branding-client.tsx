"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Info, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  SettingsHeader,
  SettingsSidebar,
  Toggle,
  SectionTitle,
  RightUtilityDock,
  AssistanceButton,
} from "@/components/settings/settings-shell";
import { saveBrandingPrefs } from "./actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaneMode    = "dark" | "light";
type Appearance  = PaneMode; // alias kept for component prop compatibility
type AccentColor = "blue" | "green" | "red" | "orange" | "purple";

const APP_NAME = "FINOS Books";

// ─── Accent colour config ─────────────────────────────────────────────────────

const ACCENT_COLORS: { id: AccentColor; label: string; hex: string }[] = [
  { id: "blue",   label: "Blue",   hex: "#4088f4" },
  { id: "green",  label: "Green",  hex: "#27AE60" },
  { id: "red",    label: "Red",    hex: "#EB5757" },
  { id: "orange", label: "Orange", hex: "#F2994A" },
  { id: "purple", label: "Purple", hex: "#9B51E0" },
];

// ─── Live DOM helpers ─────────────────────────────────────────────────────────

function applyAppearance(a: Appearance) {
  // Sets data-pane attribute — controls sidebar/topbar CSS tokens only.
  // Never touches .dark class; main content is always light.
  document.documentElement.setAttribute("data-pane", a);
}

function applyAccent(hex: string) {
  document.documentElement.style.setProperty("--finos-accent", hex);
}

// ─── Appearance card preview ──────────────────────────────────────────────────

function AppearancePreview({ type, accent }: { type: Appearance; accent: string }) {
  const isDark = type === "dark";
  return (
    <div className="w-full h-[72px] rounded overflow-hidden border border-[#e5e7eb] flex">
      <div className={`w-[26%] flex flex-col gap-[3px] pt-[6px] px-[4px] ${isDark ? "bg-[#1a2332]" : "bg-[#f4f5f7]"}`}>
        <div className={`h-[6px] rounded-sm w-full ${isDark ? "bg-[#2c3a4e]" : "bg-[#e2e5ea]"}`} />
        <div className="h-[6px] rounded-sm w-full" style={{ backgroundColor: accent }} />
        <div className={`h-[6px] rounded-sm w-[80%] ${isDark ? "bg-[#2c3a4e]" : "bg-[#e2e5ea]"}`} />
        <div className={`h-[6px] rounded-sm w-[60%] ${isDark ? "bg-[#2c3a4e]" : "bg-[#e2e5ea]"}`} />
      </div>
      <div className="flex-1 bg-white flex flex-col gap-[4px] p-[6px]">
        <div className="h-[6px] rounded bg-slate-100 w-[60%]" />
        <div className="h-[6px] rounded bg-slate-100 w-[80%]" />
        <div className="h-[6px] rounded bg-slate-100 w-[40%]" />
        <div className="mt-auto flex gap-[4px]">
          <div className="h-[8px] w-[28px] rounded" style={{ backgroundColor: accent, opacity: 0.8 }} />
          <div className="h-[8px] w-[20px] rounded bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

// ─── Toggle row ───────────────────────────────────────────────────────────────

function ToggleRow({
  label, description, checked, onChange, showInfo,
}: {
  label: string; description: string;
  checked: boolean; onChange: (v: boolean) => void; showInfo?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-slate-800">{label}</span>
          {showInfo && (
            <button type="button" title="More info" className="text-slate-400 hover:text-slate-600 transition-colors">
              <Info className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed max-w-[560px]">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">
        <Toggle checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  orgName:      string;
  logoUrl:      string | null;
  keepBranding: boolean;
  recommendApp: boolean;
}

export function BrandingClient({
  orgName, logoUrl,
  keepBranding: initialKeep, recommendApp: initialRecommend,
}: Props) {
  const router    = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search,   setSearch]   = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["organization"]));

  // Pane mode & accent — localStorage + live DOM
  const [appearance,  setAppearanceState]  = useState<Appearance>("dark");
  const [accentColor, setAccentColorState] = useState<AccentColor>("blue");

  // Org-level toggles — seeded from DB, saved back to DB
  const [keepBranding, setKeepBranding] = useState(initialKeep);
  const [recommendApp, setRecommendApp] = useState(initialRecommend);

  const [isPending, startTransition] = useTransition();

  // Hydrate pane/accent from localStorage on mount
  useEffect(() => {
    const a = localStorage.getItem("finos-pane") as Appearance | null;
    const c = localStorage.getItem("finos-accent-color") as AccentColor | null;
    if (a === "dark" || a === "light") setAppearanceState(a);
    if (c && ACCENT_COLORS.some((x) => x.id === c)) setAccentColorState(c);
  }, []);

  function setAppearance(a: Appearance) {
    setAppearanceState(a);
    localStorage.setItem("finos-pane", a);
    applyAppearance(a);
  }

  function setAccentColor(c: AccentColor) {
    setAccentColorState(c);
    localStorage.setItem("finos-accent-color", c);
    applyAccent(ACCENT_COLORS.find((x) => x.id === c)?.hex ?? "#4088f4");
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape" && search) setSearch("");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search]);

  const currentAccent = ACCENT_COLORS.find((c) => c.id === accentColor)?.hex ?? "#4088f4";

  function saveAll() {
    startTransition(async () => {
      try {
        await saveBrandingPrefs({ keepBranding, recommendApp });
        toast.success("Branding preferences saved.");
        router.refresh();
      } catch (e: any) {
        toast.error(e.message ?? "Failed to save preferences.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#f7f8fb] flex flex-col">

      <SettingsHeader
        orgName={orgName}
        breadcrumb="Branding"
        search={search}
        onSearch={setSearch}
        onClose={() => router.push("/settings")}
        searchRef={searchRef}
      />

      <div className="flex flex-1 overflow-hidden">

        <SettingsSidebar
          search={search}
          expanded={expanded}
          onToggle={toggleExpanded}
          activeItem="branding"
        />

        <main className="flex-1 overflow-y-auto">
          <div className="px-10 py-7 max-w-[880px] space-y-8">

            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Branding</h1>
              <div className="h-px bg-slate-200 mt-3" />
            </div>

            {/* ── Logo ── */}
            <section className="space-y-3">
              <SectionTitle title="Organisation Logo" />
              <div className="flex items-start gap-6 pt-1">
                <div className="shrink-0 w-[260px] h-[110px] border border-[#d8dde6] rounded-lg bg-white flex items-center justify-center overflow-hidden">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="Organisation logo" className="max-h-[80px] max-w-[220px] object-contain" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-300">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                        <span className="text-slate-400 text-[11px] font-bold uppercase">{orgName.slice(0, 2)}</span>
                      </div>
                      <span className="text-[11px] text-slate-400">No logo set</span>
                    </div>
                  )}
                </div>
                <div className="text-sm text-slate-500 space-y-2 pt-1">
                  <p>This logo appears in transaction PDFs and email notifications.</p>
                  <Link
                    href="/settings/orgprofile"
                    className="inline-flex items-center gap-1 text-[var(--finos-accent)] hover:opacity-80 font-medium transition-opacity"
                  >
                    Manage logo in Organisation Profile
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            </section>

            {/* ── Pane Appearance ── */}
            <section className="space-y-3">
              <SectionTitle title="Pane Appearance" />
              <p className="text-xs text-slate-400 -mt-1">
                Controls the sidebar and top bar style. Content, cards, and tables always remain light.
                Applies per browser — other users are not affected.
              </p>
              <div className="flex gap-4 pt-1">
                {(["dark", "light"] as Appearance[]).map((type) => {
                  const isSelected = appearance === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setAppearance(type)}
                      className={cn(
                        "w-[180px] rounded-xl border-2 p-3 text-left transition-all",
                        isSelected
                          ? "border-[var(--finos-accent)] bg-blue-50/50 shadow-sm"
                          : "border-[#e5e7eb] bg-white hover:border-slate-300"
                      )}
                    >
                      <AppearancePreview type={type} accent={currentAccent} />
                      <div className="mt-2.5 flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700 capitalize">{type} Pane</span>
                        {isSelected && (
                          <span className="w-4 h-4 rounded-full bg-[var(--finos-accent)] flex items-center justify-center">
                            <Check className="h-2.5 w-2.5 text-white" />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ── Accent Colour ── */}
            <section className="space-y-3">
              <SectionTitle title="Accent Colour" />
              <div className="flex items-center gap-2.5 pt-1 flex-wrap">
                {ACCENT_COLORS.map((c) => {
                  const isSelected = accentColor === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setAccentColor(c.id)}
                      title={c.label}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 text-xs font-medium transition-all",
                        isSelected
                          ? "border-transparent text-white shadow-sm"
                          : "border-[#e5e7eb] text-slate-600 bg-white hover:border-slate-300"
                      )}
                      style={isSelected ? { backgroundColor: c.hex, borderColor: c.hex } : {}}
                    >
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.hex }} />
                      {c.label}
                      {isSelected && <Check className="h-3 w-3 ml-0.5" />}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400 pt-0.5">
                Applies instantly across the app. Saved per-browser — not shared with other users.
              </p>
            </section>

            {/* ── Branding toggles — org-level, saved to DB ── */}
            <section className="space-y-0">
              <SectionTitle title="Branding" />
              <div className="divide-y divide-[#f0f0f0]">
                <ToggleRow
                  label={`I'd like to keep ${APP_NAME} branding for this organisation`}
                  description="Retain non-obtrusive branding, visible to your customers in transactional emails and PDFs."
                  checked={keepBranding}
                  onChange={setKeepBranding}
                />
                <ToggleRow
                  label={`I'd like to recommend ${APP_NAME} to my customers`}
                  description="Displays a small, non-intrusive banner at the bottom of the customer portal and invoice link pages shared with customers."
                  checked={recommendApp}
                  onChange={setRecommendApp}
                  showInfo
                />
              </div>
            </section>

            {/* Save / Cancel */}
            <div className="flex items-center gap-3 pt-2 pb-10">
              <button
                type="button"
                onClick={saveAll}
                disabled={isPending}
                className="h-8 px-5 text-sm font-medium text-white bg-[var(--finos-accent)] hover:opacity-90 rounded-md transition-opacity disabled:opacity-60"
              >
                {isPending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => router.push("/settings")}
                className="h-8 px-5 text-sm font-medium text-slate-600 bg-white border border-[#e5e7eb] rounded-md hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>

          </div>
        </main>

        <RightUtilityDock />
      </div>

      <AssistanceButton />
    </div>
  );
}
