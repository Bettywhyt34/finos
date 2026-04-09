import "server-only";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM    = process.env.EMAIL_FROM ?? "FINOS <noreply@finos-app.com>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://finos-app.com";

// ── Generic send ──────────────────────────────────────────────────────────────

export async function sendEmail(opts: {
  to:      string | string[];
  subject: string;
  html:    string;
  text?:   string;
}) {
  const { data, error } = await resend.emails.send({
    from:    FROM,
    to:      Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html:    opts.html,
    text:    opts.text,
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  return data;
}

// ── Transactional templates ───────────────────────────────────────────────────

/** Invite a new user to the organisation. */
export async function sendInviteEmail(opts: {
  to:         string;
  inviterName: string;
  orgName:    string;
  inviteUrl:  string;
}) {
  return sendEmail({
    to:      opts.to,
    subject: `You've been invited to ${opts.orgName} on FINOS`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1e293b">You're invited to ${opts.orgName}</h2>
        <p>${opts.inviterName} has invited you to join <strong>${opts.orgName}</strong> on FINOS — the all-in-one financial OS for modern businesses.</p>
        <a href="${opts.inviteUrl}"
           style="display:inline-block;margin:24px 0;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Accept Invitation
        </a>
        <p style="color:#64748b;font-size:13px">This link expires in 48 hours. If you didn't expect this email, you can safely ignore it.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0"/>
        <p style="color:#94a3b8;font-size:12px">
          FINOS &mdash; <a href="${APP_URL}" style="color:#94a3b8">${APP_URL}</a>
        </p>
      </div>
    `,
    text: `You've been invited to ${opts.orgName} on FINOS.\n\nAccept your invitation: ${opts.inviteUrl}\n\nThis link expires in 48 hours.`,
  });
}

/** Notify when a sync job completes (or fails). */
export async function sendSyncNotificationEmail(opts: {
  to:        string;
  sourceApp: string;
  status:    "success" | "error";
  summary:   string;
}) {
  const label  = opts.sourceApp.charAt(0).toUpperCase() + opts.sourceApp.slice(1);
  const ok     = opts.status === "success";
  const colour = ok ? "#16a34a" : "#dc2626";
  const icon   = ok ? "✓" : "✗";

  return sendEmail({
    to:      opts.to,
    subject: `${icon} FINOS sync ${ok ? "completed" : "failed"} — ${label}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:${colour}">${label} sync ${ok ? "completed" : "failed"}</h2>
        <p style="white-space:pre-wrap;background:#f8fafc;padding:16px;border-radius:6px;font-size:13px">${opts.summary}</p>
        <a href="${APP_URL}/integrations"
           style="display:inline-block;margin:16px 0;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">
          View Integrations
        </a>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0"/>
        <p style="color:#94a3b8;font-size:12px">FINOS &mdash; <a href="${APP_URL}" style="color:#94a3b8">${APP_URL}</a></p>
      </div>
    `,
    text: `${label} sync ${opts.status}.\n\n${opts.summary}\n\nView integrations: ${APP_URL}/integrations`,
  });
}

/** Password reset / magic link. */
export async function sendPasswordResetEmail(opts: {
  to:       string;
  resetUrl: string;
}) {
  return sendEmail({
    to:      opts.to,
    subject: "Reset your FINOS password",
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#1e293b">Reset your password</h2>
        <p>We received a request to reset your FINOS account password. Click the button below to choose a new password.</p>
        <a href="${opts.resetUrl}"
           style="display:inline-block;margin:24px 0;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Reset Password
        </a>
        <p style="color:#64748b;font-size:13px">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0"/>
        <p style="color:#94a3b8;font-size:12px">FINOS &mdash; <a href="${APP_URL}" style="color:#94a3b8">${APP_URL}</a></p>
      </div>
    `,
    text: `Reset your FINOS password.\n\nClick here: ${opts.resetUrl}\n\nThis link expires in 1 hour.`,
  });
}
