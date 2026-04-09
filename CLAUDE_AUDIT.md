# Claude Audit Log — FINOS v5

## Security Protocol (Active — Updated Phase 2)
1. NEVER run: npx prisma migrate dev/deploy, npx prisma db push/seed, DROP, DELETE, ALTER
2. Schema changes → write SQL to scripts/, user executes manually
3. Prisma Client only, always filter by organizationId
4. Only reference process.env.DATABASE_URL, never log/expose
5. Service keys (Revflow, XpenxFlow, EARNMARK360) NEVER exposed to browser — server-only package pattern
6. All external API calls logged to sync_logs for audit
7. API keys stored encrypted (AES-256-GCM) in integration_connections, decrypted server-side only

## Sessions

### 2026-04-06 — Week 1-2
- Project setup, Prisma 7, NextAuth v5, dashboard shell
- 27 models synced from Supabase

### 2026-04-06 — Week 3
- Customers, Vendors, Items, Invoices, Bills, Payments (full AR/AP)
- Multi-currency support (lib/fx.ts, Frankfurter API)
- FX Revaluation module (scripts/migration-revaluation.sql — executed by user)
- FX Exposure report

### 2026-04-07 — Phase 2 Week 5 Day 1 (COMPLETE)
- Packages: bullmq@5.73.0, ioredis@5.10.1, server-only@0.0.1 installed
- Prisma schema: 9 new models (IntegrationConnection, AccountMapping, SyncLog, SyncQuarantine, UnifiedTransactionsCache, RevflowCampaign, RevflowInvoice, Earnmark360Employee, Earnmark360PayrollRun)
- lib/encryption.ts: AES-256-GCM encrypt/decrypt/isEncrypted, server-only
- lib/integrations/bullmq-queue.ts: Upstash Redis connection, 3 named queues, enqueueSync(), getQueueMetrics()
- lib/integrations/sync-engine.ts: startSync(), completeSyncJob(), quarantineRecord(), upsertCache(), resolveAccountMapping(), getIntegrationStatus(), getQuarantineRecords(), retryQuarantine(), resolveQuarantine()
- lib/workers/sync-worker.ts: BullMQ worker process (run separately with npx tsx), processor registry, graceful shutdown
- .env.local: ENCRYPTION_KEY + UPSTASH_REDIS_URL stubs added
- TypeScript: 0 errors
- PENDING USER ACTION: Fill ENCRYPTION_KEY (64 hex chars) and UPSTASH_REDIS_URL in .env.local

### 2026-04-07 — Phase 2 Kickoff
- READ: FINOS_Phase2_Build.md.docx — confirmed full understanding
- WROTE: scripts/migration-phase2-integrations.sql — 9 tables (PENDING USER EXECUTION)
- Security protocol updated for Phase 2 (API key encryption, external audit logging)
- WAITING: User to run migration in Supabase SQL Editor before proceeding with Week 5

### 2026-04-07 — Phase 1.5 Budgeting Module (COMPLETE)
- SQL: scripts/migration-budgeting.sql — 5 tables: budgets, budget_versions, budget_lines, budget_approvals, budget_override_logs (pending user execution)
- Prisma: 4 enums + 5 models (Budget, BudgetVersion, BudgetLine, BudgetApproval, BudgetOverrideLog)
- Budget list (by type/year), wizard (new budget with optional copy-from prior year)
- Budget detail: monthly inline-edit grid (Jan-Dec), version tabs, approval workflow
- Budget vs Actual report: account-level comparison, Budget/Actual/Variance/Var%, Excel export
- XpenxFlow Override dialog: KEEP_FINOS / USE_EXTERNAL / MERGE decision, audit trail in budget_override_logs
- Budget Settings page: stats, approval workflow diagram, XpenxFlow config (Phase 2 slots), override audit log
- Sidebar: Budgets section (Target icon), Budget vs Actual in Reports, Budget Settings in Settings
- TypeScript: 0 errors

### 2026-04-07 — Week 4 (COMPLETE)
- SQL: scripts/migration-journal-attachments.sql — adds attachment_url, reversal_reason to journal_entries (pending user execution)
- Manual Journal Entries: list (filtered), new form (multi-line, real-time balance), detail, post + reverse actions
- Trial Balance: period filter, debit=credit validation banner, Excel export, drill-down to GL
- General Ledger: account selector, date/period filter, running balance, Excel export, source link
- P&L Statement: period range, by-account revenue/expense, prior period comparison %, Excel export
- Balance Sheet: as-of period, Assets=Liabilities+Equity validation, retained earnings, Excel export
- Cash Flow: indirect method, operating/investing/financing, bank reconciliation
- Period Close: 12-month grid, close/reopen actions with draft-count guard, year-end close with closing entries
- lib/statements.ts: shared getAccountBalances() + sumByType() helpers
- lib/journal.ts: period-lock guard on postJournalEntry()
- TypeScript: 0 errors
