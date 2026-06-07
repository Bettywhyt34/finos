"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname }      from "next/navigation";
import {
  SettingsHeader,
  SettingsSidebar,
  RightUtilityDock,
  AssistanceButton,
} from "@/components/settings/settings-shell";

// Map pathname → sidebar activeItem id (must match ids in settings-shell nav)
function getActiveItem(pathname: string): string {
  if (pathname.includes("/users-roles/roles"))            return "roles";
  if (pathname.includes("/users-roles/user-preferences")) return "user-preferences";
  return "users";
}

const BREADCRUMBS: Record<string, string> = {
  users:              "Users",
  roles:              "Roles",
  "user-preferences": "User Preferences",
};

interface Props {
  orgName:  string;
  children: React.ReactNode;
}

export function UsersRolesShell({ orgName, children }: Props) {
  const router   = useRouter();
  const pathname = usePathname();

  const searchRef                 = useRef<HTMLInputElement>(null!);
  const [search,   setSearch]     = useState("");
  const [expanded, setExpanded]   = useState<Set<string>>(new Set(["users-roles"]));

  const activeItem = getActiveItem(pathname ?? "");
  const breadcrumb = BREADCRUMBS[activeItem] ?? "Users & Roles";

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
        breadcrumb={breadcrumb}
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
          activeItem={activeItem}
        />

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>

        <RightUtilityDock />
      </div>

      <AssistanceButton />
    </div>
  );
}
