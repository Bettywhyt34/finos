# FINOS implementation plan

Owner: Codex development, coordinated in the FINOS conversation. Finance acceptance: project owner. Baseline review: 22 September 2026. Work is complete only when the stated acceptance evidence exists; estimates below are work units, not guaranteed calendar dates.

## Operating rules

1. Preserve implemented workflows and the canonical JournalEntry/JournalEntryLine ledger. No wholesale rewrite or infrastructure migration during stabilisation.
2. Develop in isolated branches. Draft PRs require review and must not auto-merge or release. Production deployment, data deletion and destructive database changes require explicit owner approval.
3. Use synthetic data in a separate local/test database. Never run migrations, seeds or write tests against production. Existing repository restrictions on database commands remain in force.
4. Before preview execution, verify its database, email, queues, integrations and secrets are isolated. Disable external side effects in tests.
5. Every financial change needs a failing behavioral regression first, the smallest correction, reconciliation evidence, and a rollback approach. Correct posted transactions with auditable reversals/adjustments.
6. Keep current strategy sections revised in place. Move superseded decisions to the version log; distinguish source-implemented, isolated-tested, staging-verified and production-verified states.

## Work queue

| ID | Priority | Deliverable | Dependencies | Indicative size |
| --- | --- | --- | --- | --- |
| C00 | P0 | Read-only live baseline and isolated development environment | Database access or approved resumption | 1–2 development days plus access |
| C01 | P0 | Reporting history and closing-entry regression patch | None | Prepared in this PR |
| C02 | P0 | Financial mutation authorization matrix and guards | C00 for integration tests | 2–3 days |
| C03 | P0 | Vendor payment atomicity, idempotency and allocation evidence | C00, C02 | 3–5 days plus migration review |
| C04 | P0 | Native and integration tax, FX and recognition reconciliation | C03 | 3–5 days |
| C05 | P0 | Ledger-backed dashboard and reconciled cash-flow reporting | C01, C04 | 3–5 days |
| C06 | P1 | Secure multi-entity switching | C00, C02 | 2–3 days |
| C07 | P1 | Bounded consolidation and intercompany reporting | C04–C06 | 5–8 days |
| C08 | P1 | First Financial Brain cash/collections workflow | C04–C06; group insights also require C07 | 4–6 days |
| C09 | P0 ongoing | CI, migration reproducibility, operational and security gates | Starts C00; gates all releases | Across every work item |

These estimates require a full runnable checkout and accessible isolated database. Sequence is dependency-led. The entire queue is not a promise to finish before the YC application target. Prefer a verified single-entity insight and honest scope over rushed consolidation.

## C00 — Establish the factual baseline

- Confirm the production connection target through authorized configuration metadata without exposing secrets. The connected FINOS Supabase project is inactive; obtain approval before resuming it, or inspect the correct replacement database if one exists.
- Read applied migration history, tables, indexes, triggers, role grants, tenant counts and reconciliation totals. Run the existing audit scripts with read-only credentials and aggregate results. Do not repair data during discovery.
- Reconcile Prisma, raw SQL and both migration directories. Build an explicitly disposable fixture database only after reviewing every migration. Document backup/restore ownership and recovery evidence.
- Obtain full source checkout at the reviewed SHA, lockfile install, generated Prisma client, lint, typecheck and build results. Keep required environment names documented without values.
- Acceptance: reproducible local/staging setup; recorded command results; schema-drift inventory; explicit unresolved findings and no production changes.

## C01 — Preserve historical statement balances

Prepared changes: remove the active-only filter from historical statements and exclude year-end transfer entries from dashboard performance, matching the existing P&L rule. Keep active-only validation for new postings.

Acceptance: `npm run test:reporting` passes all four tests. Historical inactive-account amounts survive; foreign-entity, unposted and out-of-period entries remain excluded; profit is stable before/after closing transfers. Full build and database integration gates remain pending before release.

## C02 — Authorize every financial action

- Map actions to OWNER/ADMIN/ACCOUNTANT/etc. using the actual enum and reviewed business policy. Explicitly decide who may close/reopen, post/reverse and manage integrations.
- Share a server guard that checks authenticated ACTIVE membership, active tenant and action permission. Cover server actions and API routes, not just navigation.
- Acceptance: viewer/auditor write attempts, suspended members and cross-entity IDs fail; permitted roles succeed; removal/role changes take effect on the next protected request; no privilege derived from user-editable data.

## C03 — Repair vendor settlement

- Implement stable request idempotency and locked, fresh bill balances. Acquire multi-bill locks in deterministic order and persist payment-allocation evidence in the same transaction as bills, journal and bank impact.
- Support selected bank/cash account, payment currency/rate, WHT and carrying values. Proposal must explain non-destructive backfill options for historical payments; never invent allocations that cannot be evidenced.
- Acceptance: concurrent attempts to settle the same remaining balance cannot overpay; retry of identical request returns one payment/journal; different payload with same key is rejected; injected failure leaves no partial writes; partial/multiple-bill/WHT/FX and reversal fixtures reconcile AP and cash exactly.

## C04 — Unify event accounting

- Audit each native/integration posting path against one documented event matrix: draft, issue/post, recognition, receipt/payment, credit, reversal, amendment and FX revaluation.
- Correct Revflow VAT/revenue treatment and source amendment handling. Source imports must preserve immutable versions and repeat safely.
- Use decimal or minor-unit arithmetic and explicit precision/rounding policies. Remove arbitrary default FX rates for foreign currency. Keep transaction, functional and presentation amounts distinct.
- Acceptance: two-sided journals, no duplicates, consistent tax control totals, earned/unearned reconciliation, settlement FX after partial payment and revaluation, replay and timeout recovery, and closed-period rejection across every entry path.

## C05 — Make management reporting trustworthy

- Replace overlapping cash-flow code prefixes with explicit disjoint classifications; complete noncash adjustments and investing/financing movements.
- Reconcile dashboard cash to book balances and separately show statement cash and unmatched items. Convert unlike currencies before aggregation; show valuation date/rate.
- Acceptance: golden data reconciles trial balance, GL, P&L, balance sheet, AR/AP aging, taxes and cash flow; opening cash plus net movements equals closing cash; inactive accounts and year-end close remain correct; historical reports are reproducible; stale/incomplete data is visibly identified.

## C06 — Deliver actual entity selection

- List only active memberships. Validate the requested entity server-side when switching and update session routing claims; never select a tenant solely from a client parameter.
- Invalidate query caches and pending forms on switch, keep all reads/writes scoped, and display the active entity consistently.
- Acceptance: a user in two entities can switch; a third entity is inaccessible; stale browser tabs cannot write into the wrong entity; single-entity users retain their present experience.

## C07 — Add consolidation without commingling books

- Separate group configuration and reporting adjustments from operating entity ledgers. Model membership/ownership effective dates, account mappings, intercompany counterparties and reconciliation differences.
- First release: an explicit wholly-owned, same-functional-currency group; match reciprocal balances and transactions and record auditable elimination adjustments. Unsupported ownership and FX cases must be blocked or clearly unavailable.
- Next release: finance-approved translation policies, historical equity treatment, translation differences, ownership changes and noncontrolling interests.
- Acceptance: entity A sales to B eliminate on consolidation without altering either ledger; unmatched balances remain visible; group totals reconcile to source trial balances plus adjustments; every result identifies entities, periods, mapping versions and adjustments.

## C08 — Build the first Financial Brain

- Start with a read-only 13-week cash forecast and collections risk workflow. Deterministic services calculate opening cash, expected receipts/payments, concentration and shortfall scenarios; the model explains those outputs.
- Store dataset/entity/period scope, as-of timestamp, source transaction IDs, assumptions, rule/model version, coverage and user feedback. Hide or downgrade advice when inputs are stale or incomplete.
- Create one Intelligence & Action Centre with insight, supporting calculation, evidence drill-down, proposed action and management decision. No autonomous posting or sending.
- Acceptance: traceable cash-shortfall insight and prioritized collections action on at least three permissioned/synthetic fixtures; all material numbers match deterministic results; zero unauthorized entity disclosures; malicious source-document instructions cannot authorize tools; unsupported claims are refused; model timeout yields deterministic results; latency and cost are measured.
- Expansion: profitability and project margin, control anomalies, budgets, governed action execution and recurring briefings only after this first workflow is verified.

## C09 — Continuous release gates

- CI on PRs: locked install, Prisma generation, lint/typecheck/build, isolated unit and database tests, migration rehearsal, dependency scanning, and a small authenticated E2E suite.
- Money invariants: exact balance after rounding, atomicity, request idempotency, source immutability, period locks, tenant isolation, reversals and audit actor/reason/timestamps.
- Operational readiness: integration retries/dead-letter recovery, worker health and execution-path ownership, queue/provider compatibility, structured redacted logs, health checks and backups with tested restore.
- Review the existing dependency PRs together to avoid incompatible Prisma/client/auth upgrades; do not equate an available update with a verified vulnerability fix.
- Release evidence: reviewed diff, passing gates, accepted migration/rollback proposal, backup confirmation where relevant, staged walkthrough and finance sign-off. Production deployment still requires explicit user approval.

## Immediate Codex handoff

1. Review and validate this draft reporting patch against a full checkout.
2. Complete C00 once database access is resolved; report blockers truthfully.
3. Implement C02, then C03 as separate bounded PRs with the acceptance tests above.
4. Update this queue and the living strategy after verified milestones. Do not mark a task complete merely because code exists or Vercel built it.
