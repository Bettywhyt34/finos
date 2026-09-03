import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AccrualManager } from "./accrual-manager";

interface AccrualRow {
  id: string; accrualNumber: string; accrualDate: Date; description: string; vendorId: string | null; vendorName: string | null;
  accountId: string; accountCode: string; accountName: string; projectId: string | null; projectName: string | null;
  reportingTags: Prisma.JsonValue | null; currency: string; amount: unknown; settled: unknown; released: unknown; status: string;
}
interface BillLineRow {
  id: string; billNumber: string; vendorId: string; billDate: Date; exchangeRate: unknown; accountId: string; projectId: string | null;
  reportingTags: Prisma.JsonValue | null; description: string; serviceAmount: unknown; usedAmount: unknown;
}
interface MovementRow { id: string; accrualId: string; kind: "SETTLEMENT" | "RELEASE"; movementDate: Date; target: string; amount: unknown; status: string; }
interface ReportingTagRow { id: string; name: string; optionId: string; optionName: string; }

function tags(value: Prisma.JsonValue | null): Record<string,string> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const entries = Object.entries(value).filter(([,v]) => typeof v === "string") as Array<[string,string]>;
  return entries.length ? Object.fromEntries(entries.sort(([a],[b])=>a.localeCompare(b))) : null;
}

export default async function AccrualsPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;
  const [tenant, accounts, vendors, projects, reportingTagRows, accrualRows, billRows, movementRows] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
    prisma.chartOfAccounts.findMany({ where: { tenantId, isActive: true, type: "EXPENSE" }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.vendor.findMany({ where: { tenantId, isActive: true }, select: { id: true, companyName: true }, orderBy: { companyName: "asc" } }),
    prisma.project.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.$queryRaw<ReportingTagRow[]>`
      SELECT rt."id",rt."name",rto."id" AS "optionId",rto."name" AS "optionName"
      FROM "reporting_tags" rt
      INNER JOIN "reporting_tag_options" rto ON rto."tag_id"=rt."id" AND rto."tenant_id"=rt."tenant_id"
      WHERE rt."tenant_id"=${tenantId}::uuid AND rt."is_active"=true AND rto."is_active"=true
      ORDER BY rt."name",rto."sort_order",rto."name"
    `,
    prisma.$queryRaw<AccrualRow[]>`
      SELECT a."id",a."accrual_number" AS "accrualNumber",a."accrual_date" AS "accrualDate",a."description",a."vendor_id" AS "vendorId",
             v."company_name" AS "vendorName",a."account_id" AS "accountId",coa."code" AS "accountCode",coa."name" AS "accountName",
             a."project_id" AS "projectId",p."name" AS "projectName",a."reporting_tags" AS "reportingTags",upper(a."currency") AS "currency",a."amount",a."status",
             COALESCE((SELECT SUM(s."amount") FROM "accrual_settlements" s WHERE s."tenant_id"=a."tenant_id" AND s."accrual_id"=a."id" AND s."status"='POSTED'),0) AS "settled",
             COALESCE((SELECT SUM(r."amount") FROM "accrual_releases" r WHERE r."tenant_id"=a."tenant_id" AND r."accrual_id"=a."id" AND r."status"='POSTED'),0) AS "released"
      FROM "accruals" a
      INNER JOIN "chart_of_accounts" coa ON coa."id"=a."account_id" AND coa."tenant_id"=a."tenant_id"
      LEFT JOIN "vendors" v ON v."id"=a."vendor_id" AND v."tenant_id"=a."tenant_id"
      LEFT JOIN "projects" p ON p."id"=a."project_id" AND p."tenant_id"=a."tenant_id"
      WHERE a."tenant_id"=${tenantId}::uuid
      ORDER BY a."accrual_date" DESC,a."created_at" DESC
    `,
    prisma.$queryRaw<BillLineRow[]>`
      SELECT bl."id",b."bill_number" AS "billNumber",b."vendor_id" AS "vendorId",b."bill_date" AS "billDate",b."exchange_rate" AS "exchangeRate",
             bl."account_id" AS "accountId",bl."project_id" AS "projectId",bl."reporting_tags" AS "reportingTags",bl."description",bl."amount" AS "serviceAmount",
             COALESCE((SELECT SUM(s."amount") FROM "accrual_settlements" s WHERE s."tenant_id"=${tenantId}::uuid AND s."bill_line_id"=bl."id" AND s."status"='POSTED'),0) AS "usedAmount"
      FROM "bill_lines" bl
      INNER JOIN "bills" b ON b."id"=bl."bill_id"
      INNER JOIN "chart_of_accounts" coa ON coa."id"=bl."account_id" AND coa."tenant_id"=b."tenant_id"
      WHERE b."tenant_id"=${tenantId}::uuid AND b."status"::text<>'DRAFT' AND bl."cost_recognition_mode"='IMMEDIATE' AND coa."type"::text='EXPENSE'
      ORDER BY b."bill_date" DESC,b."bill_number" DESC
    `,
    prisma.$queryRaw<MovementRow[]>`
      SELECT s."id",s."accrual_id" AS "accrualId",'SETTLEMENT'::text AS "kind",s."settlement_date" AS "movementDate",b."bill_number" AS "target",s."amount",s."status"
      FROM "accrual_settlements" s
      INNER JOIN "bill_lines" bl ON bl."id"=s."bill_line_id"
      INNER JOIN "bills" b ON b."id"=bl."bill_id"
      WHERE s."tenant_id"=${tenantId}::uuid
      UNION ALL
      SELECT r."id",r."accrual_id",'RELEASE'::text,r."release_date",r."reason",r."amount",r."status"
      FROM "accrual_releases" r
      WHERE r."tenant_id"=${tenantId}::uuid
      ORDER BY "movementDate" DESC,"id" DESC
    `,
  ]);
  const baseCurrency = tenant?.currency.trim().toUpperCase() ?? "NGN";
  const reportingTags = Array.from(new Map(reportingTagRows.map((row) => [row.id, { id: row.id, name: row.name, options: [] as Array<{id:string;name:string}> }])).values());
  for (const row of reportingTagRows) reportingTags.find((tag) => tag.id === row.id)?.options.push({ id: row.optionId, name: row.optionName });
  const accruals = accrualRows.map((a) => ({
    id: a.id, accrualNumber: a.accrualNumber, accrualDate: a.accrualDate.toISOString().slice(0,10), description: a.description,
    vendorId: a.vendorId, vendorName: a.vendorName, accountId: a.accountId, accountLabel: `${a.accountCode} — ${a.accountName}`,
    projectId: a.projectId, projectName: a.projectName, reportingTags: tags(a.reportingTags), currency: a.currency, amount: Number(a.amount),
    settled: Number(a.settled), released: Number(a.released), remaining: Math.max(0, Number(a.amount)-Number(a.settled)-Number(a.released)), status: a.status,
  }));
  const billLines = billRows.map((b) => ({
    id: b.id, billNumber: b.billNumber, vendorId: b.vendorId, billDate: b.billDate.toISOString().slice(0,10), accountId: b.accountId,
    projectId: b.projectId, reportingTags: tags(b.reportingTags), description: b.description,
    baseAmount: Math.round(Number(b.serviceAmount)*Number(b.exchangeRate)*100)/100, usedAmount: Number(b.usedAmount),
  }));
  const movements = movementRows.map((m) => ({ id:m.id, accrualId:m.accrualId, kind:m.kind, date:m.movementDate.toISOString().slice(0,10), target:m.target, amount:Number(m.amount), status:m.status }));

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold tracking-tight text-slate-900">Accruals</h1><p className="mt-1 text-sm text-slate-500">Recognise costs before the supplier Bill arrives, then clear the estimate against the later Bill without duplicating expense.</p></div>
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Open accruals</p><p className="mt-2 text-2xl font-semibold text-slate-900">{accruals.filter((a)=>a.status==="POSTED"&&a.remaining>0.005).length}</p></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Open balance</p><p className="mt-2 text-2xl font-semibold text-slate-900">{new Intl.NumberFormat("en-NG",{style:"currency",currency:baseCurrency}).format(accruals.reduce((s,a)=>s+(a.status==="POSTED"?a.remaining:0),0))}</p></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Accounting</p><p className="mt-2 text-sm font-semibold text-slate-900">Expense · Accrued Expenses · Bill clearing</p></div>
    </div>
    <AccrualManager baseCurrency={baseCurrency} accounts={accounts} vendors={vendors.map((v)=>({id:v.id,name:v.companyName}))} projects={projects} reportingTagDefinitions={reportingTags} billLines={billLines} accruals={accruals} movements={movements} />
  </div>;
}
