# FINOS implementation plan

Owner: Codex development, coordinated in the FINOS conversation. Finance acceptance: project owner. Baseline review: 22 September 2026. Work is complete only when the stated acceptance evidence exists; estimates below are work units, not guaranteed calendar dates.

## Operating rules

1. Preserve implemented workflows and the canonical JournalEntry/JournalEntryLine ledger. No wholesale rewrite or infrastructure migration during stabilisation.
2. Develop in isolated branches. Draft PRs require review and must not auto-merge or release. Production deployment, data deletion and destructive database changes require explicit owner approval.
3. Owner-authorised demo writes are confined to the two Cedarstone fictional entities in the connected FINOS database. Preserve all existing records. QVT MEDIA LTD is no longer an authorised test tenant. Use isolated test doubles or a test database for failure/concurrency tests. No database deletion or destructive migration is authorised.
4. Before preview execution, verify its database, email, queues, integrations and secrets are isolated. Disable external side effects in tests.
5. Every financial change needs a failing behavioral regression first, the smallest correction, reconciliation evidence, and a rollback approach. Correct posted transactions with auditable reversals/adjustments.
6. Keep current strategy sections revised in place. Move superseded decisions to the version log; distinguish source-implemented, isolated-tested, staging-verified and production-verified states.

## MVP completion queue

Priority is a usable MVP, with accounting controls verified inside the selected journeys. Infrastructure migration, a broad AI layer and advanced consolidation are not prerequisites.

| Step | Deliverable | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| M1 | Private fictional demo company and subsidiary | Cedarstone entities created 26 September; owner access; eight matching accounts, bank, customer, vendor and two drafts per entity | Banner and switching checked in authenticated preview |
| M2 | Invoice to receipt and bill to payment | Draft branch has role checks, settlement request IDs, locked vendor balances, selected bank and allocations | Post drafts, record partial and final settlements, retry, reverse where supported, reconcile AR/AP/cash |
| M3 | Dashboard controls and drill-downs | Selected performance periods, CSV, posted ledger cash, invoice and vendor-payment links implemented | Browser checks and ledger reconciliation |
| M4 | First Financial Brain | 13-week deterministic scenario, 0/14/30-day collection delay, evidence and decision capture implemented | Verify displayed sources and persisted responses on demo activity |
| M5 | Entity switching and basic consolidation | Membership-validated selection; same-NGN compatible-account aggregation, balanced worksheet eliminations and evidence export | Two-entity isolation and intercompany walkthrough |
| M6 | Review and release preparation | Typecheck, build and 15 isolated tests passed during implementation | Current build, changed-file lint, database concurrency and authenticated acceptance; owner production approval |

### Demo scope and records

Use **Cedarstone Media & Services — FINOS Demo** and its fictional wholly-owned **Cedarstone Studio — FINOS Demo** subsidiary. Both use NGN. Existing QVT and Bettywhyt tenants are excluded from testing and seeding. No real customer contacts, bank details or integration connections are copied. Demo membership uses the existing FINOS owner account; no passwords or public access are created.

`additional_fields.finosDemo` and `syntheticData` mark both entities. Their parent/group metadata describes the demo scenario, not verified legal ownership. A persistent banner identifies synthetic data. `scripts/fixtures/cedarstone-demo.sql` is additive and rerunnable; it contains no cleanup operation. The prior QVT seed was never executed and has been replaced.

### Walkthrough and expected results

1. In the parent, post SYNTH-MVP-INV-001 for NGN 100,000 with immediate recognition. Expected: AR 100,000 and revenue 100,000.
2. Receive gross 40,000 consisting of cash 38,000 and WHT 2,000. Expected: AR 60,000; bank 38,000; WHT receivable 2,000. Retry returns the same receipt.
3. Post SYNTH-MVP-BILL-001 for NGN 60,000. Pay gross 30,000 consisting of bank 28,500 and WHT payable 1,500. Expected: AP 30,000; bank net 9,500; profit 40,000. Retry returns the same payment.
4. Before final settlement, compare the remaining receivable/payment dates in the 13-week forecast. Delay collection 14 or 30 days; explain any shortfall from the linked documents.
5. Settle the remaining invoice and bill balances, then reconcile the subledgers, posted journals and dashboard. Do not mark this step complete from preinserted ledger fixtures.
6. Switch to Studio; parent records must be inaccessible through Studio-scoped routes. Attempt viewer writes and stale-tab settlement; both must fail.
7. Add an explicitly labelled intercompany sale and reciprocal bill for NGN 10,000 through the application. Eliminate internal revenue/cost and AR/AP only in the worksheet. Source books must not change; group trial balance must reconcile.

### Current boundaries

The vendor payment form is deliberately NGN-only; FX vendor settlement and full payment reversal remain separate accounting work. Financial Brain v1 provides deterministic explanations rather than a model-backed chat experience. Consolidation is a report worksheet with export, not a persisted group management system. Shared database is accessible through the connector, but this workspace has no runtime DATABASE_URL or authenticated preview session. This blocks direct application-to-database browser validation until configured; it is not a request to deploy production.

The detailed control backlog below remains applicable to release readiness without replacing the MVP sequence above.

## C00 — Establish the factual baseline

- Confirm the production connection target through authorized configuration metadata without exposing secrets. The owner resumed FINOS; status is ACTIVE_HEALTHY. Read-only schema and 46 existing audit queries completed with zero violations, but journals and both payment tables are empty. Confirm deployment connection identity and build representative isolated fixtures.
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

- Implement stable request idempotency and locked, fresh bill balances. Acquire multi-bill locks in deterministic order and reuse the existing live vendor_payment_allocations table and persist payment-allocation evidence in the same transaction as bills, journal and bank impact.
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

## Immediate implementation handoff

1. Preserve the Cedarstone setup and current draft branch; do not rerun any former QVT seed.
2. Configure a non-production runtime using authorised demo access, with outbound email/integrations disabled, then execute the walkthrough above.
3. Close remaining accounting and browser issues before calling the MVP accepted. Full repository lint has existing errors; record them separately from changed-file findings.
4. Update this plan and the existing strategy in place after verified milestones. Production deployment and deletion remain separate owner approvals.
