"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, UserPlus } from "lucide-react";

type Role = "OWNER" | "ADMIN" | "ACCOUNTANT" | "MEMBER" | "VIEWER";

interface Member {
  id: string;
  role: Role;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
}

const ROLE_COLORS: Record<Role, string> = {
  OWNER:      "bg-violet-100 text-violet-700",
  ADMIN:      "bg-blue-100 text-blue-700",
  ACCOUNTANT: "bg-emerald-100 text-emerald-700",
  MEMBER:     "bg-slate-100 text-slate-700",
  VIEWER:     "bg-orange-100 text-orange-700",
};

const EDITABLE_ROLES: Role[] = ["ADMIN", "ACCOUNTANT", "MEMBER", "VIEWER"];

interface Props {
  members: Member[];
  currentUserId: string;
}

export default function UsersClient({ members: initial, currentUserId }: Props) {
  const [members, setMembers] = useState<Member[]>(initial);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("MEMBER");
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch("/api/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add member");
      setMembers((prev) => [...prev, data]);
      setInviteEmail("");
      toast.success("Member added successfully.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error adding member.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(membershipId: string, role: Role) {
    setChangingRole(membershipId);
    try {
      const res = await fetch(`/api/settings/users/${membershipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update role");
      setMembers((prev) =>
        prev.map((m) => (m.id === membershipId ? { ...m, ...data } : m))
      );
      toast.success("Role updated.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error updating role.");
    } finally {
      setChangingRole(null);
    }
  }

  async function handleRemove(membershipId: string) {
    if (!confirm("Remove this member from the organisation?")) return;
    setRemoving(membershipId);
    try {
      const res = await fetch(`/api/settings/users/${membershipId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove member");
      setMembers((prev) => prev.filter((m) => m.id !== membershipId));
      toast.success("Member removed.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error removing member.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Invite Form */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Add Member
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="invite-email">Email Address</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="colleague@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleInvite()}
            />
          </div>
          <div className="w-48 space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select
              value={inviteRole}
              onValueChange={(v) => setInviteRole((v ?? "MEMBER") as Role)}
            >
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDITABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r.charAt(0) + r.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
            <UserPlus className="mr-2 h-4 w-4" />
            {inviting ? "Adding…" : "Add Member"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          The user must already have a FINOS account. They will be added immediately.
        </p>
      </div>

      {/* Members Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Team Members ({members.length})
          </h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">
                  {m.user.name ?? "—"}
                </TableCell>
                <TableCell className="text-slate-500">{m.user.email}</TableCell>
                <TableCell>
                  {m.role === "OWNER" ? (
                    <Badge className={ROLE_COLORS.OWNER}>Owner</Badge>
                  ) : (
                    <Select
                      value={m.role}
                      onValueChange={(v) =>
                        handleRoleChange(m.id, (v ?? m.role) as Role)
                      }
                      disabled={changingRole === m.id}
                    >
                      <SelectTrigger className="h-7 w-36 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EDITABLE_ROLES.map((r) => (
                          <SelectItem key={r} value={r} className="text-xs">
                            {r.charAt(0) + r.slice(1).toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell className="text-slate-500 text-sm">
                  {new Date(m.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  {m.role !== "OWNER" && m.user.id !== currentUserId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                      disabled={removing === m.id}
                      onClick={() => handleRemove(m.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
