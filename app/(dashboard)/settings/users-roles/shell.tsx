"use client";

import { usePathname }      from "next/navigation";
import { FullSettingsShell } from "@/components/settings/settings-shell";

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
  const pathname   = usePathname();
  const activeItem = getActiveItem(pathname ?? "");
  const breadcrumb = BREADCRUMBS[activeItem] ?? "Users & Roles";

  return (
    <FullSettingsShell orgName={orgName} activeItem={activeItem} breadcrumb={breadcrumb}>
      <div className="h-full overflow-y-auto">
        {children}
      </div>
    </FullSettingsShell>
  );
}
