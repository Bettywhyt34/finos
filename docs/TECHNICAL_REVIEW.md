# FINOS technical review

Review date: 22 September 2026. Baseline: `6afa9440f2b40a3def9a5a7f96a549f3ac052fb9` (`main`, 7 September). Scope: repository inventory; targeted frontend, server action, integration and schema review; connected deployment metadata; completed read-only database inspection. This is not a complete security audit or production certification.

## Conclusion

Preserve the existing accounting application and harden it incrementally. Do not replace the stack or rebuild working screens. The principal risk is inconsistency between transaction paths: mature receipt and journal controls coexist with weaker vendor settlements, reporting calculations and integration posting. Stabilise those paths before expanding consolidation or AI.

## Verified architecture

- Frontend and backend: Next.js 16 App Router, React 19, TypeScript, Tailwind, server components, server actions and API routes in one application.
- Authentication: NextAuth v5, Prisma adapter, JWT routing claims. `lib/auth-config.ts` revalidates exact ACTIVE entity membership and tenant status in the server session callback. Preserve this control; comments elsewhere incorrectly describe auth as having no database calls.
- Persistence: Prisma 7 using adapter-pg and PostgreSQL on Supabase. `Tenant` is the operational entity boundary; memberships and transaction queries use `tenantId`.
- Accounting authority: `JournalEntry` and `JournalEntryLine` through `lib/journal.ts`. `lib/accounting/journals.ts` is a compatibility adapter, not a separate posting engine. Legacy `JournalLine` still exists in the schema; do not delete it without dependency and data reconciliation.
- Integrations: Revflow, XpenxFlow, Earnmark360, BettyWhyt and FINOS POS; registry, source cache, sync logs and quarantine concepts exist. Queued and inline processing coexist.
- Hosting: Vercel Next.js serverless, Node 24, London region. Latest production deployment references exactly the reviewed commit and is READY. The public login page returned HTTP 200; that does not establish authenticated application health.
- Database: connected FINOS project reports INACTIVE. Read-only table inspection timed out. Live schema, applied migrations, balances, grants, backups and user workflows remain unverified. No resume, migration or data mutation was performed.
- No Convex or Cloudflare implementation was identified in the reviewed default-branch inventory. Do not treat an earlier migration preference as an implemented architecture.

## Features to preserve

The following are implemented in source, not newly certified end to end: invoice and bill drafts; transactional posting; customer receipts and reversal evidence; credit notes and quote conversion; project revenue recognition; system-account mappings; period controls; bank import, matching and reconciliation; trial balance, GL, P&L, balance sheet, aging, budgets and FX views.

`lib/journal.ts` validates one-sided nonnegative finite lines, balance, active entity-owned accounts and dimensions; uses period and journal-number advisory locks; and rechecks source idempotency. Invoice and receipt paths contain substantial transaction and evidence logic. Preserve those invariants while extending them to weaker paths.

## Findings and required changes

### F01 Critical — vendor settlement concurrency and retry safety

`app/(dashboard)/purchases/bills/actions.ts`, `recordBillPayment`, reads bill balances before acquiring the tenant vendor-payment lock. It later writes absolute `amountPaid` values derived from that earlier snapshot. Concurrent requests can both accept the same remaining balance, create separate payment journals and overwrite the paid total. A newly generated payment ID is also used as journal source ID, so resubmission is not deduplicated at the business-request level.

Acquire bill locks in deterministic order before reading balances; re-read and validate in the transaction; persist allocations; enforce request idempotency; use conditional updates and retry only safe failures. Demonstrate two concurrent attempts cannot overallocate and that retry returns the original result. Static finding; not exercised on live data.

### F02 Critical — vendor payment accounting evidence and FX

The same function posts the entered amount directly to the GL, does not select bill currency/exchange rate, and always uses DEFAULT_BANK. `VendorPayment` has no currency, bank account or allocation relation in the checked Prisma model. Bill balances are updated without durable per-bill payment allocation records in this path. Foreign-currency amounts can therefore be treated as NGN and realised FX is not represented.

Design persisted payment currency, settlement rate, selected cash/bank ledger, allocations, booked carrying amount, WHT and realised FX evidence. Reconcile AP, cash and tax control accounts. Initially reject unsupported currency combinations rather than accepting ambiguous postings. Schema changes need a reviewed non-destructive proposal and isolated migration rehearsal.

### F03 High — incomplete role enforcement on mutations

Bill creation/posting/payment, manual journal actions, period close/reopen, FX actions and sampled integration sync endpoints authenticate entity membership but do not enforce a mutation role. The shared role helper exists, but is not consistently called by these paths. A UI-hidden button is not server authorization.

Define explicit action permissions and enforce them on every write entry point. A VIEWER/AUDITOR must not post, reverse, close, reopen or trigger privileged sync. Test missing, suspended and foreign-entity memberships as well as role changes. Preserve the existing live membership validation.

### F04 High — account deactivation erases historical reporting

`lib/statements.ts` selected only active chart accounts before mapping posted balances. `toggleAccountStatus` allows an account to become inactive. Its history consequently disappears from all statements using the helper.

Prepared fix: retain all entity accounts in statement reads, while posting validation continues to reject inactive accounts. A test reproduces 100 instead of 300 before the fix and 300 after it. The test uses the actual module with an isolated database double.

### F05 High — dashboard loses results after year-end close

`getFinancialOverview` called `getAccountBalances` without excluding `year-end-close`; the P&L page already excludes that source. Closing transfers consequently zero trading income and expenses on the dashboard.

Prepared fix: use the same exclusion for dashboard performance. Tests demonstrate 700 revenue and 500 profit with and without closing entries. This does not change balance-sheet retained earnings treatment.

### F06 High — cash-flow statement classifications overlap

`app/(dashboard)/reports/cash-flow/page.tsx` adds the `CA-001` prefix to the broader `CA-00` prefix for AR, `CA-003` plus `CA-00` for cash, and `CL-001` plus `CL-00` for AP. These sets overlap and the broader sets include unrelated accounts. AR, cash and AP can be double-counted or misclassified. The calculation only derives operating flow from profit plus AR/AP movements; remaining noncash, investing and financing classifications need completion.

Use explicit system-account/category mappings with disjoint sets, complete movement classification and a reconciliation to opening/closing ledger cash. Reproduce a simple cash/AR/AP fixture before implementation. Do not present the existing page as a validated cash-flow statement.

### F07 High — mixed currencies and independent bank balances

`getFinancialOverview` totals native invoice balances, bill balances and bank `currentBalance` without currency/rate selection, then labels the result using tenant currency. `banking/[id]/actions.ts` records a bank row and replaces a balance from a pretransaction read without posting a GL entry. Determine whether this is statement-side evidence or a book transaction; those concepts must not share an ambiguous balance.

Define transaction, functional and presentation currency explicitly. Derive book cash from the ledger; retain statement cash separately and reconcile. Use atomic updates or recomputation for any cached balance. Label source currency values individually and never add unlike currencies.

### F08 High — Revflow posting bypasses tax and recognition distinctions

`lib/integrations/revflow/processor.ts`, `postInvoiceGL`, debits AR and credits revenue using `totalAmount * exchangeRate`, despite carrying `taxAmount` separately. It does not split output VAT. Source record updates and posting are separate operations; subsequent changed source amounts update the cache without a corresponding correction when a journal already exists.

Route canonical integration events through the same tax/recognition rules as native documents. Preserve immutable source versions, post explicit corrections/reversals for changes and reconcile source totals, ledger amounts and sync evidence. Test taxable, unearned, amended, duplicate and partially failed records.

### F09 High — schema and migration reproducibility

Prisma omits several fields accessed via raw SQL, including bill tax snapshots and newer receipt evidence. Migrations live in both `prisma/migrations` and `scripts/migration-*.sql`. Two bill-tax migrations share the same timestamp prefix and almost identical DDL. Some migrations are destructive (for example removal of legacy campaigns).

This proves multiple schema representations, not the live database's current condition. Inventory applied versions and checksums, compare catalog to Prisma, then build a fresh isolated database from a reviewed baseline. Do not blindly replay scripts or rename already-applied migrations. Historical destructive scripts are not authorized for execution.

### F10 Medium — entity switcher and consolidation are incomplete

`components/dashboard/header.tsx` shows only the current company and empty group/holding/personal labels. It has no entity selection action. JWT update selects the earliest active membership rather than a requested validated tenant. The schema inventory contains no group ownership/elimination/consolidation-run model.

Implement secure entity selection first, with cache invalidation and two-entity leakage tests. Then add a separate group reporting layer with account mapping, intercompany matching/elimination, ownership scope, currency translation and provenance. Consolidated adjustments must not overwrite entity books. Start with a clearly bounded wholly-owned/same-currency group; expand ownership and FX only after finance review.

### F11 Medium — Financial Brain is not yet an end-to-end feature

AI preferences explicitly says Coming Soon. No implemented insight/evidence/action service was identified in the reviewed route/model inventory. Existing dashboard narratives are deterministic summaries, not evidence of a deployed Financial Brain.

First deliver a read-only 13-week cash/collections workflow over reconciled records, with deterministic calculations, data freshness and coverage, cited transaction IDs, explicit assumptions and a recorded management decision. Add generative explanation behind a provider interface. AI must not create authoritative ledger numbers or execute financial actions autonomously.

### F12 High — production verification and integration execution gaps

No committed CI workflow or unit/E2E suite was found in the baseline inventory; accounting scripts are useful read-only SQL audits but require a live database. Fourteen dependency update PRs are open and require triage, not blind merging. `MEMORY.md` and portions of `CLAUDE_AUDIT.md` describe an outdated April baseline. Vercel configuration does not establish a deployed long-lived worker. The worker registry omits FINOS POS, although POS currently has an inline route; verify each actual execution path. Queue custom job IDs use colons and need compatibility verification against the pinned BullMQ release.

Add isolated integration tests, CI gates, a reproducible schema setup, dependency/security review, backup/restore proof, redacted monitoring and worker runbooks. Check that preview deployments cannot use production databases, webhooks, email or schedulers.

## Validation completed and limits

- Default-branch inventory and targeted source inspection; production deployment SHA matches reviewed SHA.
- Public login HTTP 200; no authenticated browser workflow exercised.
- Four local reporting regression tests execute actual TypeScript modules with database doubles: two failed before the patch; all four pass after it.
- Full install, lint, typecheck, build, concurrency and end-to-end flows have NOT been run in this review workspace. It holds a targeted source snapshot, not a full verified build checkout.
- The owner resumed Supabase. Read-only review confirmed ACTIVE_HEALTHY, 93 public tables, 2 tenants, and zero journal entries, customer payments or vendor payments. All 46 queries from the four existing accounting, Money In, invoice settlement and Project audit scripts returned zero violations; empty transaction tables limit behavioral assurance. Receipt atomicity/allocation constraint triggers and the named allocation unique index exist.
- Security catalog: RLS enabled on 85 of 93 public tables; neither anon nor authenticated has SELECT on any of the 93. The advisor returned 36 informational RLS-without-policy findings, consistent with a server-only access design; no full security certification is implied. Remediation reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Prisma migration history contains one completed record and zero unfinished records; complete migration reconciliation remains pending. Live vendor_payment_allocations exists: C03 must reuse and validate it rather than assume the table is absent.
- No production deployment, migration, data deletion, email sending or financial transaction was performed by this review.

See `DEVELOPMENT_PLAN.md` for sequencing and acceptance criteria.
