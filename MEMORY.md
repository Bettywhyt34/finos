# FINOS v5.0 Project Memory

## Current Status
Phase 1, Week 1, Day 5 - COMPLETE

## Completed
- [2026-04-06] Day 1: Next.js 14, shadcn/ui, all deps, folder structure, schema
- [2026-04-06] Day 2: prisma.config.ts (Prisma 7 datasource), lib/prisma.ts (adapter-pg), .env.local
- [2026-04-06] Day 3: lib/auth.ts (NextAuth v5 + Google + PrismaAdapter + JWT strategy)
- [2026-04-06] Day 4: lib/auth-config.ts (JWT hook injects tenant_id/role/org_id)
- [2026-04-06] route handler: app/api/auth/[...nextauth]/route.ts
- [2026-04-06] middleware.ts: route protection + org-less redirect
- [2026-04-06] types/next-auth.d.ts: Session/JWT type extensions
- [2026-04-06] Zero TypeScript errors confirmed

## In Progress
- Week 1, Day 6: Dashboard shell with full sidebar navigation

## Blockers
- DB runtime connection (DATABASE_URL) still returning "Tenant or user not found" — app cannot query DB yet. Password in .env.local may still be wrong.

## Decisions Made
- [2026-04-06] JWT strategy (not database) — no DB read per request; adapter used for User/Account/VerificationToken only
- [2026-04-06] DIRECT_URL for migrations (port 5432), DATABASE_URL for runtime (port 6543 pgBouncer)
- [2026-04-06] `update()` trigger re-fetches membership (org creation/switching)

## Next Immediate Task
- Week 1, Day 6: Full sidebar + navigation shell
  - components/navigation/sidebar.tsx
  - components/navigation/header.tsx
  - Update app/(dashboard)/layout.tsx with real nav
  - Add all route links (banking, customers, vendors, etc.)

## Technical Debt
- None yet
