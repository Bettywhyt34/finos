/**
 * Client-side service layer for user management.
 * Calls /api/settings/users and /api/settings/invitations routes.
 */

export type UserRole          = "OWNER" | "ADMIN" | "ACCOUNTANT" | "MEMBER" | "VIEWER";
export type EditableRole      = Exclude<UserRole, "OWNER">;
export type MembershipStatus  = "ACTIVE" | "INACTIVE";

export interface MemberUser {
  id:            string;
  name:          string | null;
  email:         string | null;
  image:         string | null;
  emailVerified: string | null;
}

/** A real TenantMembership row. */
export interface MemberRow {
  type:      "member";
  id:        string;
  role:      UserRole;
  status:    MembershipStatus;
  createdAt: string;
  updatedAt: string;
  user:      MemberUser;
}

/** A pending TenantInvitation row (not yet accepted). */
export interface InvitationRow {
  type:      "invitation";
  id:        string;
  role:      UserRole;
  status:    "PENDING";
  email:     string;
  createdAt: string;
  expiresAt: string;
}

export type UnifiedUser = MemberRow | InvitationRow;

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Fetch all members + pending invitations for the current tenant. */
export async function getUsers(): Promise<UnifiedUser[]> {
  const res = await fetch("/api/settings/users");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to fetch users");
  }
  return res.json();
}

// ─── Invite ───────────────────────────────────────────────────────────────────

/**
 * Smart invite:
 *   - If email has a FINOS account → MemberRow returned (added immediately)
 *   - If email is unknown          → InvitationRow returned (email sent if delivery is connected)
 */
export async function inviteUser(payload: {
  email: string;
  role:  EditableRole;
}): Promise<UnifiedUser> {
  const res = await fetch("/api/settings/users", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to invite user");
  return data;
}

/**
 * Invite an accountant — wraps inviteUser with ACCOUNTANT or VIEWER role.
 */
export async function inviteAccountant(payload: {
  email:       string;
  accessLevel: "ACCOUNTANT" | "VIEWER";
}): Promise<UnifiedUser> {
  return inviteUser({ email: payload.email, role: payload.accessLevel });
}

// ─── Membership updates ───────────────────────────────────────────────────────

/** Change a member's role. */
export async function updateUserRole(
  membershipId: string,
  role: EditableRole,
): Promise<MemberRow> {
  const res = await fetch(`/api/settings/users/${membershipId}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ role }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to update role");
  return data;
}

/** Activate or deactivate a membership. */
export async function updateUserStatus(
  membershipId: string,
  status: MembershipStatus,
): Promise<MemberRow> {
  const res = await fetch(`/api/settings/users/${membershipId}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ status }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to update status");
  return data;
}

/**
 * Soft-deactivate a member (sets status = INACTIVE).
 * Hard deletion is not supported; the record is kept for audit purposes.
 */
export async function removeUser(membershipId: string): Promise<void> {
  const res = await fetch(`/api/settings/users/${membershipId}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to deactivate user");
}

// ─── Invitation management ────────────────────────────────────────────────────

/** Revoke a pending invitation. */
export async function revokeInvitation(invitationId: string): Promise<void> {
  const res = await fetch(`/api/settings/invitations/${invitationId}`, { method: "PATCH" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to revoke invitation");
}

/** Regenerate token + resend the invitation email. */
export async function resendInvitation(invitationId: string): Promise<InvitationRow> {
  const res = await fetch(`/api/settings/invitations/${invitationId}/resend`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to resend invitation");
  return data;
}
