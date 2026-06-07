/**
 * /accept-invite?token=<uuid>
 *
 * Public page — accessible without authentication.
 * Shows invitation details (org, role, inviter) before the user
 * signs in or creates an account.
 *
 * Actual membership creation happens in the JWT callback (lib/auth-config.ts)
 * on first sign-in — this page is purely informational + a sign-in gateway.
 */
import { redirect }    from "next/navigation";
import Link             from "next/link";
import { auth }         from "@/lib/auth";
import { prisma }       from "@/lib/prisma";
import { Button }       from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ROLE_LABEL: Record<string, string> = {
  OWNER:      "Owner",
  ADMIN:      "Administrator",
  ACCOUNTANT: "Accountant",
  MEMBER:     "Member",
  VIEWER:     "Viewer",
};

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function AcceptInvitePage({ searchParams }: Props) {
  const { token } = await searchParams;

  // ── Authenticated users: if they already have a tenant, send to dashboard ──
  const session = await auth();
  if (session?.user?.tenantId) {
    redirect("/");
  }

  // ── Token required ─────────────────────────────────────────────────────────
  if (!token) {
    return <InviteCard state="invalid" />;
  }

  // ── Look up the invitation ─────────────────────────────────────────────────
  const invitation = await prisma.tenantInvitation.findUnique({
    where:   { token },
    include: {
      tenant:    { select: { name: true } },
      invitedBy: { select: { name: true, email: true } },
    },
  });

  if (!invitation) {
    return <InviteCard state="invalid" />;
  }

  if (invitation.status === "REVOKED") {
    return <InviteCard state="revoked" orgName={invitation.tenant.name} />;
  }

  if (invitation.status === "ACCEPTED") {
    return <InviteCard state="accepted" orgName={invitation.tenant.name} />;
  }

  if (invitation.status === "EXPIRED" || invitation.expiresAt < new Date()) {
    return <InviteCard state="expired" orgName={invitation.tenant.name} />;
  }

  // ── Valid PENDING invitation ───────────────────────────────────────────────
  const inviterName = invitation.invitedBy.name ?? invitation.invitedBy.email ?? "A team member";
  const roleName    = ROLE_LABEL[invitation.role] ?? invitation.role;
  const expiresOn   = invitation.expiresAt.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  // Encode the callback URL so after login the token is still available
  // (auto-accept in JWT callback uses email, not token — token is for context only)
  const loginUrl  = `/login`;
  const signupUrl = `/signup`;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center space-y-2 pb-4">
          <div className="text-4xl font-bold tracking-tight">FINOS</div>
          <CardTitle className="text-xl font-semibold">You&apos;ve been invited</CardTitle>
          <CardDescription>
            {inviterName} has invited you to join{" "}
            <span className="font-medium text-slate-800">{invitation.tenant.name}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Invitation details */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg divide-y divide-slate-100">
            <div className="flex justify-between items-center px-4 py-3 text-sm">
              <span className="text-slate-500">Organisation</span>
              <span className="font-medium text-slate-800">{invitation.tenant.name}</span>
            </div>
            <div className="flex justify-between items-center px-4 py-3 text-sm">
              <span className="text-slate-500">Role</span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                {roleName}
              </span>
            </div>
            <div className="flex justify-between items-center px-4 py-3 text-sm">
              <span className="text-slate-500">Invited by</span>
              <span className="font-medium text-slate-800">{inviterName}</span>
            </div>
            <div className="flex justify-between items-center px-4 py-3 text-sm">
              <span className="text-slate-500">Expires</span>
              <span className="text-slate-600">{expiresOn}</span>
            </div>
          </div>

          <p className="text-sm text-slate-500 text-center">
            Sign in or create an account to accept this invitation. Your membership will
            be activated automatically when you sign in with the email address this
            invitation was sent to.
          </p>

          <div className="space-y-2">
            <Link href={loginUrl} className="block">
              <Button className="w-full">Sign in to accept</Button>
            </Link>
            <Link href={signupUrl} className="block">
              <Button variant="outline" className="w-full">Create an account</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Error/state cards ──────────────────────────────────────────────────────────

type InviteState = "invalid" | "expired" | "revoked" | "accepted";

const STATE_COPY: Record<InviteState, { title: string; description: string; action: string; href: string }> = {
  invalid: {
    title:       "Invalid invitation link",
    description: "This invitation link is invalid or has already been used. Contact your administrator to request a new one.",
    action:      "Go to sign in",
    href:        "/login",
  },
  expired: {
    title:       "Invitation expired",
    description: "This invitation link has expired. Contact your administrator to request a new one.",
    action:      "Go to sign in",
    href:        "/login",
  },
  revoked: {
    title:       "Invitation revoked",
    description: "This invitation has been revoked by an administrator. Contact your organisation if you believe this is an error.",
    action:      "Go to sign in",
    href:        "/login",
  },
  accepted: {
    title:       "Already accepted",
    description: "This invitation has already been accepted. Sign in to access your workspace.",
    action:      "Sign in",
    href:        "/login",
  },
};

function InviteCard({ state, orgName }: { state: InviteState; orgName?: string }) {
  const copy = STATE_COPY[state];
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center space-y-2 pb-4">
          <div className="text-4xl font-bold tracking-tight">FINOS</div>
          <CardTitle className="text-xl font-semibold">{copy.title}</CardTitle>
          {orgName && (
            <CardDescription>
              Organisation: <span className="font-medium text-slate-800">{orgName}</span>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-500 text-center">{copy.description}</p>
          <Link href={copy.href} className="block">
            <Button className="w-full">{copy.action}</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
