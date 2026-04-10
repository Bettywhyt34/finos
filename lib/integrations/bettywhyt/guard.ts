/**
 * BettyWhyt is a private integration — only one org (the owner) should
 * have access to it. Gate all BettyWhyt routes/pages with this helper.
 *
 * Set BETTYWHYT_ORG_ID in .env.local to your organisation's ID.
 * Leave it empty to disable access entirely.
 */

export function isBettywhytOrg(orgId: string): boolean {
  const allowed = process.env.BETTYWHYT_ORG_ID?.trim();
  if (!allowed) return false;
  return orgId.trim() === allowed;
}
