"use client";

import { useState } from "react";
import { toast }    from "sonner";
import {
  MoreHorizontal, Plus, Shield, ShieldCheck, ShieldAlert,
  X, AlertTriangle, Info, Users, Lock, CheckCircle2,
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
  PERMISSION_GROUPS,
  getRoleUsage,
  type UserRole,
  type RoleWithStats,
  type PermissionGroup,
} from "@/lib/roles/service";

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

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  roles:     RoleWithStats[];
  canManage: boolean;
}

// ─── Role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role, size = "sm" }: { role: UserRole; size?: "xs" | "sm" }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full font-medium",
      size === "xs" ? "px-2 py-0.5 text-xs" : "px-2.5 py-0.5 text-xs",
      ROLE_COLORS[role],
    )}>
      {ROLE_LABEL[role]}
    </span>
  );
}

// ─── Sensitive role indicator ─────────────────────────────────────────────────

function SensitiveWarning() {
  return (
    <span title="Includes Settings access" className="inline-flex items-center gap-1 text-xs text-amber-600 ml-1.5">
      <AlertTriangle className="h-3 w-3" />
      <span className="hidden sm:inline">Settings access</span>
    </span>
  );
}

// ─── Permission groups list ───────────────────────────────────────────────────

function PermissionGroupsList({ groups }: { groups: PermissionGroup[] }) {
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.id} className="border border-slate-200 rounded-lg p-3">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <p className="text-sm font-medium text-slate-800">{g.label}</p>
            {g.enforced ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200 shrink-0">
                <CheckCircle2 className="h-3 w-3" />
                Currently enforced
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200 shrink-0">
                Planned
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mb-2">{g.description}</p>
          <div className="flex flex-wrap gap-1">
            {g.grantedTo.map((role) => (
              <RoleBadge key={role} role={role} size="xs" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

function RoleDetailDrawer({ role, onClose }: { role: RoleWithStats; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-[60]" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[440px] max-w-full bg-white shadow-2xl z-[61] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <Shield className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-800">Role Details</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <RoleBadge role={role.id} size="sm" />
              {role.sensitive && <SensitiveWarning />}
              <span className="ml-auto text-xs text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                System
              </span>
            </div>
            <p className="text-sm text-slate-600">{role.description}</p>
          </div>

          <div className="flex items-center gap-6 py-3 border-y border-slate-100">
            <div className="flex items-center gap-1.5 text-sm text-slate-600">
              <Users className="h-4 w-4 text-slate-400" />
              <span className="font-medium text-slate-800">{role.userCount}</span>
              <span>active user{role.userCount !== 1 ? "s" : ""} assigned</span>
            </div>
            {role.inactiveCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-slate-400">
                <span className="font-medium">{role.inactiveCount}</span>
                <span>inactive</span>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Who can do what
            </h3>
            <PermissionGroupsList groups={PERMISSION_GROUPS} />
            <p className="mt-3 text-xs text-slate-400">
              Some permission controls are planned and will become active when custom roles are enabled.
            </p>
          </div>

          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200">
            <Lock className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-500">
              System roles are managed by FINOS and cannot be edited or deleted.
            </p>
          </div>
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-slate-200">
          <Button variant="outline" className="w-full" onClick={onClose}>Close</Button>
        </div>
      </div>
    </>
  );
}

// ─── New role drawer (honest stub) ───────────────────────────────────────────

function NewRoleDrawer({ onClose }: { onClose: () => void }) {
  const [name, setName]               = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate]       = useState<string>("");
  const [saving, setSaving]           = useState(false);

  function handleSave() {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      toast.error("Custom roles backend is not connected yet. This feature is coming in a future update.");
    }, 400);
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-[60]" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[440px] max-w-full bg-white shadow-2xl z-[61] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-800">New Role</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-blue-50 border border-blue-200">
            <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700">
              Custom roles are not yet connected to the backend. You can design a role here,
              but it will not be saved until this feature ships.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="role-name" className="text-sm font-medium text-slate-700">Role Name</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Finance Manager"
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="role-desc" className="text-sm font-medium text-slate-700">Description</Label>
            <textarea
              id="role-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this role can access..."
              rows={3}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--finos-accent)]/25 focus:border-[var(--finos-accent)] resize-none placeholder:text-slate-400"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-700">Start From Template</Label>
            <Select value={template} onValueChange={(v) => setTemplate(v ?? "")}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Choose an existing role to copy from" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="ACCOUNTANT">Accountant</SelectItem>
                <SelectItem value="MEMBER">Member</SelectItem>
                <SelectItem value="VIEWER">Viewer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Permission Groups</p>
            <div className="border border-dashed border-slate-300 rounded-lg p-4 text-center">
              <ShieldAlert className="h-6 w-6 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-400">
                Fine-grained permission controls will be available when custom roles are enabled.
              </p>
            </div>
          </div>
        </div>

        <div className="shrink-0 px-5 py-4 border-t border-slate-200 flex gap-3">
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Role"}
          </Button>
          <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
        </div>
      </div>
    </>
  );
}

// ─── Actions menu ─────────────────────────────────────────────────────────────

function RoleActionsMenu({ role, onView }: { role: RoleWithStats; onView: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        aria-label="Role actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20">
            <button
              onClick={() => { setOpen(false); onView(); }}
              className="w-full text-left px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5"
            >
              <Info className="h-3.5 w-3.5 text-slate-400" />
              View Details
            </button>
            <button
              disabled
              title="System roles are managed by FINOS and cannot be edited."
              className="w-full text-left px-3.5 py-2 text-sm text-slate-400 cursor-not-allowed flex items-center gap-2.5"
            >
              <Lock className="h-3.5 w-3.5 text-slate-300" />
              Edit Role
            </button>
            <button
              disabled
              title="System roles are managed by FINOS and cannot be edited."
              className="w-full text-left px-3.5 py-2 text-sm text-slate-400 cursor-not-allowed flex items-center gap-2.5"
            >
              <Lock className="h-3.5 w-3.5 text-slate-300" />
              Delete Role
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RolesClient({ roles, canManage }: Props) {
  const [selectedRole,  setSelectedRole]  = useState<RoleWithStats | null>(null);
  const [showNewDrawer, setShowNewDrawer] = useState(false);

  const usage = getRoleUsage(roles);

  // ── Access restricted ──────────────────────────────────────────────────────

  if (!canManage) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center max-w-sm">
          <Lock className="h-10 w-10 text-slate-300 mx-auto mb-4" />
          <h2 className="text-base font-semibold text-slate-800 mb-1">Access Restricted</h2>
          <p className="text-sm text-slate-500">
            Only Owners and Admins can view and manage roles.
          </p>
        </div>
      </div>
    );
  }

  // ── Content ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="max-w-5xl mx-auto px-8 py-8 space-y-5">

            {/* Page header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Roles</h1>
                <div className="h-px bg-slate-200 mt-3" />
              </div>
              <Button size="sm" className="flex items-center gap-1.5" onClick={() => setShowNewDrawer(true)}>
                <Plus className="h-3.5 w-3.5" />
                New Role
              </Button>
            </div>

            {/* Summary chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Roles",    value: usage.totalRoles,    icon: Shield },
                { label: "System Roles",   value: usage.systemRoles,   icon: Lock },
                { label: "Custom Roles",   value: usage.customRoles,   icon: ShieldCheck },
                { label: "Active Members", value: usage.usersAssigned, icon: Users },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-center gap-3">
                  <Icon className="h-4 w-4 text-slate-400 shrink-0" />
                  <div>
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-lg font-semibold text-slate-800 leading-tight">{value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Callout */}
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-slate-50 border border-slate-200">
              <Info className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
              <p className="text-sm text-slate-500">
                FINOS currently uses system roles. Custom roles will allow you to create tailored
                access levels for your team.
              </p>
            </div>

            {/* Roles table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Role Name</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Active Users</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide hidden md:table-cell">Description</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide hidden lg:table-cell">Last Updated</th>
                      <th className="w-12 px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((role, idx) => (
                      <tr
                        key={role.id}
                        className={cn(
                          "hover:bg-slate-50/60 transition-colors cursor-pointer",
                          idx < roles.length - 1 && "border-b border-slate-100"
                        )}
                        onClick={() => setSelectedRole(role)}
                      >
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <RoleBadge role={role.id} />
                            {role.sensitive && <SensitiveWarning />}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                            System
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5 text-slate-700">
                            <Users className="h-3.5 w-3.5 text-slate-400" />
                            <span className="font-medium">{role.userCount}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-slate-500 max-w-xs hidden md:table-cell">
                          <span className="line-clamp-1">{role.description}</span>
                        </td>
                        <td className="px-4 py-3.5 text-slate-400 hidden lg:table-cell">—</td>
                        <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <RoleActionsMenu role={role} onView={() => setSelectedRole(role)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Permissions overview */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <ShieldAlert className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-800">Permissions Overview</h2>
                <span className="ml-auto text-xs text-slate-400 flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Planned groups shown in grey
                </span>
              </div>
              <PermissionGroupsList groups={PERMISSION_GROUPS} />
              <p className="mt-4 text-xs text-slate-400">
                Some permission controls are planned and will become active when custom roles are enabled.
              </p>
            </div>

      </div>

      {selectedRole && (
        <RoleDetailDrawer role={selectedRole} onClose={() => setSelectedRole(null)} />
      )}
      {showNewDrawer && (
        <NewRoleDrawer onClose={() => setShowNewDrawer(false)} />
      )}
    </>
  );
}
