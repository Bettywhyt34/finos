"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import {
  SettingsHeader,
  SettingsSidebar,
  SectionTitle,
  RightUtilityDock,
  AssistanceButton,
} from "@/components/settings/settings-shell";

interface Props {
  orgName: string;
}

export function AIClient({ orgName }: Props) {
  const router    = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search,   setSearch]   = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["organization"]));

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && search) setSearch("");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search]);

  return (
    <div className="fixed inset-0 z-50 bg-[#f7f8fb] flex flex-col">

      <SettingsHeader
        orgName={orgName}
        breadcrumb="AI Preferences"
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
          activeItem="ai"
        />

        <main className="flex-1 overflow-y-auto">
          <div className="px-10 py-7 max-w-[880px] space-y-8">

            <div>
              <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">AI Preferences</h1>
              <div className="h-px bg-slate-200 dark:bg-slate-700 mt-3" />
            </div>

            <section className="space-y-3">
              <SectionTitle title="AI Preferences" />
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                  <Sparkles className="h-6 w-6 text-slate-400" />
                </div>
                <h2 className="text-base font-semibold text-slate-700 mb-1">Coming Soon</h2>
                <p className="text-sm text-slate-500 max-w-[360px]">
                  AI-powered features and model configuration are under development.
                  You&apos;ll soon be able to choose providers, models, and toggle individual
                  AI capabilities per feature.
                </p>
              </div>
            </section>

          </div>
        </main>

        <RightUtilityDock />
      </div>

      <AssistanceButton />
    </div>
  );
}
