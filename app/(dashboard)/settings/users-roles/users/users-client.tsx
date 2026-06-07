"use client";

import { useState, useMemo } from "react";
import { toast }              from "sonner";
import {
  ChevronDown, MoreHorizontal, UserPlus, UserCheck,
  Info, X, Trash2, ShieldCheck, CheckCircle2, Users,
  RotateCcw, SendHorizonal, Ban, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { Label }  from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  inviteUser,
  inviteAccountant,
  updateUserRole,
  updateUserStatus,
  removeUser,
  revokeInvitation,
  resendInvitation,
  type UnifiedUser,
  type MemberRow,
  type InvitationRow,
  type UserRole,
  type EditableRole,
} from "@/lib/users/service";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<UserRole, string> = {
  OWNER:      "Owner",
  ADMIN:      "Admin",
  ACCOUNTANT: "Accountant",
  MEMBER:     "Member",
  VIEWER:     "Viewer",
};

const ROLE_COLORS: Record<UserRole, string> = {
  OWNER:      "bg-violet-50 text-violet-700 border border-violet-200",
  ADMIN:      "bg-blue-50 text-blue-700 border border-blue-200",
  ACCOUNTANT: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  MEMBER:     "bg-slate-100 text-slate-600 border border-slate-200",
  VIEWER:     "bg-amber-50 text-amber-700 border border-amber-200",
};

const EDITABLE_ROLES: EditableRole[] = ["ADMIN", "ACCOUNTANT", "MEMBER", "VIEWER"];

type FilterValue = "all" | "active" | "inactive" | "pending" | "admins" | "accountants";

const FILTER_OPTIONS: { value: FilterValue; label: string }[] = [
  { value: "all",         label: "All Users"      },
  { value: "active",      label: "Active Users"   },
  { value: "inactive",    label: "Inactive Users" },
  { value: "pending",     label: "Pending Users"  },
  { value: "admins",      label: "Admins"         },
  { value: "accountants", label: "Accountants"    },
];

// ─── Avatar ───────────────────────────────────────────────────────────────────

function UserAvatar({
  name, email, image, size = "md",
}: {
  name?: string | null; email?: string | null; image?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const display = name ?? (email ? email.split("@")[0] : "?");
  const initials = display
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const cls = cn(
    "rounded-full flex items-center justify-center font-semibold shrink-0 select-none",
    size === "lg" ? "w-14 h-14 text-xl" : size === "md" ? "w-9 h-9 text-sm" : "w-7 h-7 text-xs",
  );

  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt={name ?? "User"} className={cn(cls, "object-cover")} />;
  }

  return (
    <div className={cn(cls, "bg-slate-200 text-slate-600")}>{initials}</div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "ACTIVE" | "INACTIVE" | "PENDING" | "EXPIRED" }) {
  if (status === "ACTIVE") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
        <CheckCircle2 className="h-3 w-3" />
        Active
      </span>
    );
  }
  if (status === "INACTIVE") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200">
        <Ban className="h-3 w-3" />
        Inactive
      </span>
    );
  }
  if (status === "EXPIRED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-200">
        <Ban className="h-3 w-3" />
        Expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
      <SendHorizonal className="h-3 w-3" />
      Pending
    </span>
  );
}

/** Derives the effective display status for an invitation row. */
function inviteStatus(u: { expiresAt: string }): "PENDING" | "EXPIRED" {
  return new Date(u.expiresAt) < new Date() ? "EXPIRED" : "PENDING";
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  users:         UnifiedUser[];
  currentUserId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UsersClient({ users: initial, currentUserId }: Props) {

  // Table
  const [users,       setUsers]       = useState<UnifiedUser[]>(initial);
  const [filter,      setFilter]      = useState<FilterValue>("all");
  const [filterOpen,  setFilterOpen]  = useState(false);
  const [moreOpen,    setMoreOpen]    = useState(false);

  // Detail drawer
  const [detail,      setDetail]      = useState<UnifiedUser | null>(null);
  const [drawerRole,  setDrawerRole]  = useState<EditableRole>("MEMBER");
  const [savingRole,  setSavingRole]  = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [removing,    setRemoving]    = useState(false);

  // Invite User modal
  const [inviteUserOpen, setInviteUserOpen] = useState(false);
  const [iuEmail,        setIuEmail]        = useState("");
  const [iuRole,         setIuRole]         = useState<EditableRole>("MEMBER");
  const [iuBusy,         setIuBusy]         = useState(false);

  // Invite Accountant modal
  const [inviteAccOpen,  setInviteAccOpen]  = useState(false);
  const [iaEmail,        setIaEmail]        = useState("");
  const [iaLevel,        setIaLevel]        = useState<"ACCOUNTANT" | "VIEWER">("ACCOUNTANT");
  const [iaBusy,         setIaBusy]         = useState(false);

  // How-to modal
  const [howToOpen, setHowToOpen] = useState(false);

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = useMemo<UnifiedUser[]>(() => {
    switch (filter) {
      case "active":
        return users.filter((u) => u.type === "member" && u.status === "ACTIVE");
      case "inactive":
        return users.filter((u) => u.type === "member" && u.status === "INACTIVE");
      case "pending":
        return users.filter((u) => u.type === "invitation");
      case "admins":
        return users.filter(
          (u) => u.type === "member" && u.status === "ACTIVE" && (u.role === "OWNER" || u.role === "ADMIN"),
        );
      case "accountants":
        return users.filter(
          (u) => u.type === "member" && u.status === "ACTIVE" && u.role === "ACCOUNTANT",
        );
      default:
        return users;
    }
  }, [users, filter]);

  const filterLabel = FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? "All Users";

  // ── Invite User ────────────────────────────────────────────────────────────

  async function handleInviteUser() {
    if (!iuEmail.trim()) return;
    setIuBusy(true);
    try {
      const result = await inviteUser({ email: iuEmail.trim(), role: iuRole });
      setUsers((prev) => {
        // If email existed as a pending invitation, remove it and add the new member
        const withoutOldInvite = prev.filter(
          (u) => !(u.type === "invitation" && u.email === iuEmail.trim()),
        );
        return [...withoutOldInvite, result];
      });

      if (result.type === "member") {
        toast.success("User added to organisation.");
      } else {
        const inv = result as InvitationRow & { emailSent?: boolean };
        if (inv.emailSent) {
          toast.success("Invitation sent. They will be added automatically when they sign in.");
        } else {
          toast.warning("Invitation created but email delivery is not connected yet. Share the login link manually.");
        }
      }

      setInviteUserOpen(false);
      setIuEmail(""); setIuRole("MEMBER");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to invite user.";
      toast.error(msg);
    } finally {
      setIuBusy(false);
    }
  }

  // ── Invite Accountant ──────────────────────────────────────────────────────

  async function handleInviteAccountant() {
    if (!iaEmail.trim()) return;
    setIaBusy(true);
    try {
      const result = await inviteAccountant({ email: iaEmail.trim(), accessLevel: iaLevel });
      setUsers((prev) => {
        const withoutOldInvite = prev.filter(
          (u) => !(u.type === "invitation" && u.email === iaEmail.trim()),
        );
        return [...withoutOldInvite, result];
      });

      if (result.type === "member") {
        toast.success("Accountant added to organisation.");
      } else {
        const inv = result as InvitationRow & { emailSent?: boolean };
        if (inv.emailSent) {
          toast.success("Invitation sent. They will be added automatically when they sign in.");
        } else {
          toast.warning("Invitation created but email delivery is not connected yet. Share the login link manually.");
        }
      }

      setInviteAccOpen(false);
      setIaEmail(""); setIaLevel("ACCOUNTANT");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to invite accountant.");
    } finally {
      setIaBusy(false);
    }
  }

  // ── Role change ────────────────────────────────────────────────────────────

  async function handleRoleChange(membershipId: string, role: EditableRole) {
    setSavingRole(true);
    try {
      const updated = await updateUserRole(membershipId, role);
      setUsers((prev) => prev.map((u) => u.id === membershipId ? updated : u));
      setDetail((prev) => prev?.id === membershipId ? updated : prev);
      toast.success("Role updated.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update role.");
    } finally {
      setSavingRole(false);
    }
  }

  // ── Status change (mark active / inactive) ─────────────────────────────────

  async function handleStatusChange(membershipId: string, status: "ACTIVE" | "INACTIVE") {
    setSavingStatus(true);
    try {
      const updated = await updateUserStatus(membershipId, status);
      setUsers((prev) => prev.map((u) => u.id === membershipId ? updated : u));
      setDetail((prev) => prev?.id === membershipId ? updated : prev);
      toast.success(status === "ACTIVE" ? "User reactivated." : "User deactivated.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update status.");
    } finally {
      setSavingStatus(false);
    }
  }

  // ── Remove (soft-deactivate) ───────────────────────────────────────────────

  async function handleRemove(membershipId: string) {
    setRemoving(true);
    try {
      await removeUser(membershipId);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === membershipId && u.type === "member"
            ? { ...u, status: "INACTIVE" as const }
            : u,
        ),
      );
      setDetail(null);
      toast.success("User access revoked. They are now inactive.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to revoke access.");
    } finally {
      setRemoving(false);
    }
  }

  // ── Revoke invitation ──────────────────────────────────────────────────────

  async function handleRevoke(invitationId: string) {
    try {
      await revokeInvitation(invitationId);
      setUsers((prev) => prev.filter((u) => u.id !== invitationId));
      setDetail(null);
      toast.success("Invitation revoked.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to revoke invitation.");
    }
  }

  // ── Resend invitation ──────────────────────────────────────────────────────

  async function handleResend(invitationId: string) {
    try {
      const updated = await resendInvitation(invitationId);
      setUsers((prev) => prev.map((u) => u.id === invitationId ? updated : u));
      setDetail(updated);

      const inv = updated as InvitationRow & { emailSent?: boolean };
      if (inv.emailSent) {
        toast.success("Invitation resent successfully.");
      } else {
        toast.warning("Invitation token refreshed but email delivery is not connected yet.");
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to resend invitation.");
    }
  }

  // ── Open drawer ────────────────────────────────────────────────────────────

  function openDetail(u: UnifiedUser) {
    setDetail(u);
    if (u.type === "member" && u.role !== "OWNER") {
      setDrawerRole(u.role as EditableRole);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="max-w-5xl mx-auto px-8 py-8 space-y-5">

            {/* ── Title row ── */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              {/* Left: title + filter */}
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-slate-900">All Users</h1>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { setFilterOpen((o) => !o); setMoreOpen(false); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
                  >
                    {filterLabel}
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                  {filterOpen && (
                    <div className="absolute top-full left-0 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1">
                      {FILTER_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => { setFilter(opt.value); setFilterOpen(false); }}
                          className={cn(
                            "w-full text-left px-4 py-2 text-sm transition-colors",
                            filter === opt.value
                              ? "bg-slate-100 text-slate-900 font-medium"
                              : "text-slate-600 hover:bg-slate-50",
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: actions */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHowToOpen(true)}
                  title="How to add users"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
                >
                  <Info className="h-4 w-4" />
                  <span className="hidden sm:inline">How to add users</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setInviteAccOpen(true); setMoreOpen(false); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
                >
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span className="hidden sm:inline">Invite Accountant</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setInviteUserOpen(true); setMoreOpen(false); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white rounded-lg transition-colors shadow-sm"
                  style={{ backgroundColor: "var(--finos-accent)" }}
                >
                  <UserPlus className="h-4 w-4" />
                  <span className="hidden sm:inline">Invite User</span>
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { setMoreOpen((o) => !o); setFilterOpen(false); }}
                    className="flex items-center justify-center w-9 h-9 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
                    title="More options"
                  >
                    <MoreHorizontal className="h-4 w-4 text-slate-500" />
                  </button>
                  {moreOpen && (
                    <div className="absolute top-full right-0 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1">
                      <button type="button" className="w-full text-left px-4 py-2 text-sm text-slate-400 cursor-not-allowed" disabled>Export Users</button>
                      <button type="button" className="w-full text-left px-4 py-2 text-sm text-slate-400 cursor-not-allowed" disabled>Import Users</button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Table ── */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-3 w-1/2">
                      User Details
                    </th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-3">
                      Role
                    </th>
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-3">
                      Status
                    </th>
                    <th className="w-16 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-16 text-center">
                        <Users className="h-10 w-10 mx-auto text-slate-300 mb-3" />
                        <p className="text-slate-500 text-sm">
                          {users.length === 0
                            ? "No users found yet. Invite your first user to get started."
                            : "No users found for this filter."}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((u) => (
                      <tr
                        key={u.id}
                        onClick={() => openDetail(u)}
                        className={cn(
                          "hover:bg-slate-50 transition-colors cursor-pointer group",
                          u.type === "member" && u.status === "INACTIVE" && "opacity-60",
                        )}
                      >
                        {/* USER DETAILS */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            {u.type === "member" ? (
                              <>
                                <UserAvatar name={u.user.name} image={u.user.image} size="md" />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-900 truncate">
                                    {u.user.name ?? "—"}
                                    {u.user.id === currentUserId && (
                                      <span className="ml-2 text-xs text-slate-400 font-normal">(you)</span>
                                    )}
                                  </p>
                                  <p className="text-xs text-slate-500 truncate">{u.user.email ?? "—"}</p>
                                </div>
                              </>
                            ) : (
                              <>
                                <UserAvatar email={u.email} size="md" />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-900 truncate">
                                    {u.email.split("@")[0]}
                                  </p>
                                  <p className="text-xs text-slate-500 truncate">{u.email}</p>
                                </div>
                              </>
                            )}
                          </div>
                        </td>

                        {/* ROLE */}
                        <td className="px-6 py-4">
                          <span className={cn(
                            "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                            ROLE_COLORS[u.role],
                          )}>
                            {ROLE_LABEL[u.role]}
                          </span>
                        </td>

                        {/* STATUS */}
                        <td className="px-6 py-4">
                          <StatusBadge status={u.type === "invitation" ? inviteStatus(u) : u.status} />
                        </td>

                        {/* Quick action */}
                        <td className="px-4 py-4 text-right">
                          {u.type === "invitation" ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleRevoke(u.id); }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                              title="Revoke invitation"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          ) : (
                            u.role !== "OWNER" && u.user.id !== currentUserId && u.status === "ACTIVE" && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!confirm(`Revoke access for ${u.user.name ?? u.user.email ?? "this user"}?`)) return;
                                  handleRemove(u.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                                title="Revoke access"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {filtered.length > 0 && (
                <div className="px-6 py-3 border-t border-slate-100 bg-slate-50">
                  <p className="text-xs text-slate-400">
                    {filtered.length} {filtered.length === 1 ? "user" : "users"}
                    {filter !== "all" && ` · ${filterLabel}`}
                  </p>
                </div>
              )}
            </div>

      </div>

      {/* Close dropdowns on outside click */}
      {(filterOpen || moreOpen) && (
        <div className="fixed inset-0 z-10" onClick={() => { setFilterOpen(false); setMoreOpen(false); }} />
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          Invite User Modal
      ──────────────────────────────────────────────────────────────────────── */}
      {inviteUserOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={(e) => { if (e.target === e.currentTarget) setInviteUserOpen(false); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <UserPlus className="h-5 w-5 text-slate-400" />
                <h2 className="text-base font-semibold text-slate-900">Invite User</h2>
              </div>
              <button type="button" onClick={() => setInviteUserOpen(false)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="iu-email">
                  Email Address <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="iu-email"
                  type="email"
                  placeholder="jane@company.com"
                  value={iuEmail}
                  onChange={(e) => setIuEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleInviteUser()}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="iu-role">Role</Label>
                <Select
                  value={iuRole}
                  onValueChange={(v) => setIuRole((v ?? "MEMBER") as EditableRole)}
                >
                  <SelectTrigger id="iu-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EDITABLE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  <span className="text-sm text-slate-600">Active — set automatically on join</span>
                </div>
              </div>

              <p className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                If the email has a FINOS account, they are added immediately.
                Otherwise, an invitation is created and an email is sent.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
              <Button type="button" variant="outline" onClick={() => setInviteUserOpen(false)} disabled={iuBusy}>
                Cancel
              </Button>
              <Button type="button" onClick={handleInviteUser} disabled={iuBusy || !iuEmail.trim()}>
                {iuBusy ? "Sending…" : "Send Invite"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          Invite Accountant Modal
      ──────────────────────────────────────────────────────────────────────── */}
      {inviteAccOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={(e) => { if (e.target === e.currentTarget) setInviteAccOpen(false); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <UserCheck className="h-5 w-5 text-emerald-600" />
                <h2 className="text-base font-semibold text-slate-900">Invite Accountant</h2>
              </div>
              <button type="button" onClick={() => setInviteAccOpen(false)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ia-email">
                  Email Address <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="ia-email"
                  type="email"
                  placeholder="accountant@firm.com"
                  value={iaEmail}
                  onChange={(e) => setIaEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleInviteAccountant()}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ia-level">Access Level</Label>
                <Select
                  value={iaLevel}
                  onValueChange={(v) => setIaLevel((v ?? "ACCOUNTANT") as "ACCOUNTANT" | "VIEWER")}
                >
                  <SelectTrigger id="ia-level"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACCOUNTANT">Full Access (Accountant)</SelectItem>
                    <SelectItem value="VIEWER">Read Only (Viewer)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <p className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                If the email has a FINOS account, they are added immediately.
                Otherwise, an invitation is created and an email is sent.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
              <Button type="button" variant="outline" onClick={() => setInviteAccOpen(false)} disabled={iaBusy}>
                Cancel
              </Button>
              <Button type="button" onClick={handleInviteAccountant} disabled={iaBusy || !iaEmail.trim()}>
                {iaBusy ? "Sending…" : "Send Invite"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          How to Add Users
      ──────────────────────────────────────────────────────────────────────── */}
      {howToOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={(e) => { if (e.target === e.currentTarget) setHowToOpen(false); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <Info className="h-5 w-5 text-blue-500" />
                <h2 className="text-base font-semibold text-slate-900">How to Add Users</h2>
              </div>
              <button type="button" onClick={() => setHowToOpen(false)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 text-sm text-slate-600">
              <p><strong className="text-slate-800">Existing FINOS account</strong> — Enter their email in Invite User. They are added immediately.</p>
              <p><strong className="text-slate-800">New user</strong> — Enter their email. An invitation record is created and a link is emailed. When they sign in, they join automatically.</p>
              <p><strong className="text-slate-800">Accountant</strong> — Use Invite Accountant. The same flow applies, with ACCOUNTANT or Viewer role pre-selected.</p>
              <p className="text-xs text-slate-400">Pending rows appear in the table until the invitation is accepted or revoked.</p>
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-slate-100 bg-slate-50">
              <Button type="button" variant="outline" onClick={() => setHowToOpen(false)}>Got it</Button>
            </div>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          User / Invitation Detail Drawer
      ──────────────────────────────────────────────────────────────────────── */}

      {detail && (
        <div className="fixed inset-0 z-[60] bg-black/20" onClick={() => setDetail(null)} />
      )}

      <div className={cn(
        "fixed top-0 right-0 bottom-0 w-[380px] bg-white border-l border-slate-200 shadow-2xl z-[61] flex flex-col transform transition-transform duration-300",
        detail ? "translate-x-0" : "translate-x-full",
      )}>
        {detail && (
          <>
            {/* Drawer header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
              <h2 className="text-base font-semibold text-slate-900">
                {detail.type === "invitation" ? "Invitation Details" : "User Details"}
              </h2>
              <button type="button" onClick={() => setDetail(null)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

              {/* Identity */}
              <div className="flex items-center gap-4">
                {detail.type === "member" ? (
                  <>
                    <UserAvatar name={detail.user.name} image={detail.user.image} size="lg" />
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-slate-900 truncate">
                        {detail.user.name ?? "—"}
                        {detail.user.id === currentUserId && (
                          <span className="ml-2 text-sm text-slate-400 font-normal">(you)</span>
                        )}
                      </p>
                      <p className="text-sm text-slate-500 truncate">{detail.user.email ?? "—"}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <UserAvatar email={detail.email} size="lg" />
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-slate-900 truncate">
                        {detail.email.split("@")[0]}
                      </p>
                      <p className="text-sm text-slate-500 truncate">{detail.email}</p>
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-4">
                {/* Role */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Role</Label>
                  {detail.type === "invitation" || detail.role !== "OWNER" ? (
                    detail.type === "invitation" ? (
                      <div className="flex items-center px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                        <span className={cn("text-sm font-medium", ROLE_COLORS[detail.role].split(" ")[1])}>
                          {ROLE_LABEL[detail.role]}
                        </span>
                        <span className="text-xs text-amber-400 ml-auto">Invited role</span>
                      </div>
                    ) : (
                      <Select
                        value={drawerRole}
                        onValueChange={(v) => {
                          const role = (v ?? drawerRole) as EditableRole;
                          setDrawerRole(role);
                          handleRoleChange(detail.id, role);
                        }}
                        disabled={savingRole}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {EDITABLE_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 border border-violet-200 rounded-lg">
                      <span className="text-sm font-medium text-violet-700">Owner</span>
                      <span className="text-xs text-violet-400 ml-auto">Cannot be changed</span>
                    </div>
                  )}
                </div>

                {/* Status */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</Label>
                  <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                    <StatusBadge status={detail.type === "invitation" ? inviteStatus(detail) : detail.status} />
                  </div>
                </div>

                {/* Member-specific fields */}
                {detail.type === "member" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Email Verified</Label>
                      <div className="flex items-center px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-sm text-slate-600">
                          {detail.user.emailVerified
                            ? `Verified on ${new Date(detail.user.emailVerified).toLocaleDateString()}`
                            : "Not verified"}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Member Since</Label>
                      <div className="flex items-center px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-sm text-slate-600">
                          {new Date(detail.createdAt).toLocaleDateString("en-GB", {
                            day: "numeric", month: "long", year: "numeric",
                          })}
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {/* Invitation-specific fields */}
                {detail.type === "invitation" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Expires</Label>
                    <div className="flex items-center px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                      <span className={cn(
                        "text-sm",
                        new Date(detail.expiresAt) < new Date() ? "text-red-600" : "text-slate-600",
                      )}>
                        {new Date(detail.expiresAt).toLocaleDateString("en-GB", {
                          day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Drawer footer — actions */}
            <div className="shrink-0 px-6 py-4 border-t border-slate-100 space-y-2">
              {detail.type === "invitation" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => handleResend(detail.id)}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Resend Invitation
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                    onClick={() => {
                      if (!confirm(`Revoke invitation for ${detail.email}?`)) return;
                      handleRevoke(detail.id);
                    }}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Revoke Invitation
                  </Button>
                </>
              ) : detail.role !== "OWNER" && detail.user.id !== currentUserId ? (
                detail.status === "ACTIVE" ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full text-slate-600"
                      disabled={savingStatus}
                      onClick={() => handleStatusChange(detail.id, "INACTIVE")}
                    >
                      <Ban className="h-4 w-4 mr-2" />
                      {savingStatus ? "Deactivating…" : "Deactivate User"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                      disabled={removing}
                      onClick={() => {
                        if (!confirm(`Revoke access for ${detail.user.name ?? detail.user.email ?? "this user"}?`)) return;
                        handleRemove(detail.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      {removing ? "Revoking…" : "Revoke Access"}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full text-green-700 border-green-200 hover:bg-green-50"
                    disabled={savingStatus}
                    onClick={() => handleStatusChange(detail.id, "ACTIVE")}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    {savingStatus ? "Reactivating…" : "Reactivate User"}
                  </Button>
                )
              ) : null}
            </div>
          </>
        )}
      </div>
    </>
  );
}
