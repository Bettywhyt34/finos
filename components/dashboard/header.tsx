"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, User, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HeaderProps {
  userName: string | null | undefined;
  userImage: string | null | undefined;
  orgName: string | null | undefined;
}

export function Header({ userName, userImage, orgName }: HeaderProps) {
  const router = useRouter();

  const initials = userName
    ? userName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "U";

  return (
    <header className="h-14 flex items-center justify-between px-6 shrink-0 border-b border-[var(--topbar-border)] bg-[var(--topbar-bg)]">
      <p className="text-sm font-medium text-[var(--topbar-org)] truncate">{orgName}</p>

      <div className="flex items-center gap-3">
        {/* New Invoice — always accent-coloured so it pops in both pane modes */}
        <Link
          href="/sales/invoices/new"
          className="inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium rounded-md text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--finos-accent)" }}
        >
          <Plus className="h-4 w-4" />
          New Invoice
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center justify-center h-8 w-8 rounded-full text-xs font-semibold focus:outline-none overflow-hidden transition-opacity hover:opacity-80 text-[var(--topbar-text)] bg-[var(--topbar-avatar-bg)]"
          >
            {userImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={userImage} alt={userName ?? "User"} className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-3 py-2">
              <p className="text-sm font-medium truncate">{userName}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings/organization")} className="cursor-pointer">
              <User className="h-4 w-4 mr-2" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              variant="destructive"
              className="cursor-pointer"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
