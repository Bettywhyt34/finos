"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, User, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface HeaderProps {
  userName: string | null | undefined;
  userImage: string | null | undefined;
  orgName: string | null | undefined;
}

export function Header({ userName, userImage, orgName }: HeaderProps) {
  const router = useRouter();

  const initials = userName
    ? userName
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  return (
    <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-6 shrink-0">
      <p className="text-sm font-medium text-slate-700 truncate">{orgName}</p>

      <div className="flex items-center gap-3">
        <Link
          href="/sales/invoices/new"
          className={cn(buttonVariants({ size: "sm" }))}
        >
          <Plus className="h-4 w-4 mr-1" />
          New Invoice
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center justify-center h-8 w-8 rounded-full bg-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-300 transition-colors focus:outline-none overflow-hidden">
            {userImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={userImage}
                alt={userName ?? "User"}
                className="h-full w-full object-cover"
              />
            ) : (
              initials
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-3 py-2">
              <p className="text-sm font-medium truncate">{userName}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.push("/settings/organization")}
              className="cursor-pointer"
            >
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
