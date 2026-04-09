import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const B = 'C:/Users/digit/Projects/finos/finos-v5';

function w(p, c) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, c, 'utf8');
  console.log('✓', p.replace(B, ''));
}

// ════════════════════════════════════════════════════════════
// VENDORS
// ════════════════════════════════════════════════════════════

w(`${B}/app/(dashboard)/vendors/actions.ts`, `"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function createVendor(formData: FormData) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return { error: "Unauthorized" };

  const vendorCode = String(formData.get("vendorCode") || "").trim();
  const companyName = String(formData.get("companyName") || "").trim();
  if (!vendorCode || !companyName) return { error: "Code and company name are required" };

  try {
    await prisma.vendor.create({
      data: {
        organizationId: orgId,
        vendorCode,
        companyName,
        contactName: String(formData.get("contactName") || "") || null,
        email: String(formData.get("email") || "") || null,
        phone: String(formData.get("phone") || "") || null,
        address: String(formData.get("address") || "") || null,
        paymentTerms: parseInt(String(formData.get("paymentTerms") || "30")),
        bankName: String(formData.get("bankName") || "") || null,
        bankAccount: String(formData.get("bankAccount") || "") || null,
        isWhtEligible: formData.get("isWhtEligible") === "true",
      },
    });
    revalidatePath("/vendors");
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) return { error: "Vendor code already exists" };
    return { error: msg };
  }
}

export async function deactivateVendor(id: string) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return { error: "Unauthorized" };
  await prisma.vendor.update({ where: { id, organizationId: orgId }, data: { isActive: false } });
  revalidatePath("/vendors");
  return { success: true };
}
`);

w(`${B}/app/(dashboard)/vendors/vendor-form.tsx`, `"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { createVendor } from "./actions";

export function VendorForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWht, setIsWht] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("isWhtEligible", isWht ? "true" : "false");
    const result = await createVendor(fd);
    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    toast.success("Vendor created");
    setOpen(false);
    setIsWht(false);
    (e.target as HTMLFormElement).reset();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Vendor
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Vendor</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="vendorCode">Vendor Code *</Label>
                <Input id="vendorCode" name="vendorCode" placeholder="VEN-001" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companyName">Company Name *</Label>
                <Input id="companyName" name="companyName" placeholder="Supplier Ltd" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="contactName">Contact Name</Label>
                <Input id="contactName" name="contactName" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paymentTerms">Payment Terms (days)</Label>
                <Input id="paymentTerms" name="paymentTerms" type="number" defaultValue="30" min="0" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <Input id="address" name="address" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="bankName">Bank Name</Label>
                <Input id="bankName" name="bankName" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bankAccount">Bank Account Number</Label>
                <Input id="bankAccount" name="bankAccount" />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="isWhtEligible"
                checked={isWht}
                onCheckedChange={(v) => setIsWht(v === true)}
              />
              <Label htmlFor="isWhtEligible" className="cursor-pointer font-normal">
                WHT Eligible (Withholding Tax applies to payments)
              </Label>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <DialogFooter className="pt-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Create Vendor"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
`);

w(`${B}/app/(dashboard)/vendors/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Truck, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { VendorForm } from "./vendor-form";
import { formatCurrency, cn } from "@/lib/utils";

export default async function VendorsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const vendors = await prisma.vendor.findMany({
    where: { organizationId, isActive: true },
    include: {
      bills: { select: { totalAmount: true, amountPaid: true } },
    },
    orderBy: { companyName: "asc" },
  });

  const totalBalance = vendors.reduce((sum, v) => {
    const billed = v.bills.reduce((s, b) => s + parseFloat(String(b.totalAmount)), 0);
    const paid = v.bills.reduce((s, b) => s + parseFloat(String(b.amountPaid)), 0);
    return sum + (billed - paid);
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Vendors</h1>
          <p className="text-sm text-slate-500 mt-1">
            {vendors.length} vendor{vendors.length !== 1 ? "s" : ""} ·
            AP Balance: {formatCurrency(totalBalance)}
          </p>
        </div>
        <VendorForm />
      </div>

      {vendors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <Truck className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No vendors yet</p>
          <p className="text-sm text-slate-400">Add your first vendor to start processing bills.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Code</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Company</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Contact</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Email</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Terms</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">WHT</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Balance</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vendors.map((v) => {
                const billed = v.bills.reduce((s, b) => s + parseFloat(String(b.totalAmount)), 0);
                const paid = v.bills.reduce((s, b) => s + parseFloat(String(b.amountPaid)), 0);
                const balance = billed - paid;
                return (
                  <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{v.vendorCode}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{v.companyName}</td>
                    <td className="px-4 py-3 text-slate-600">{v.contactName || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{v.email || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{v.paymentTerms}d</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {v.isWhtEligible && (
                        <Badge variant="outline" className="text-amber-600 border-amber-200">WHT</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium">
                      <span className={balance > 0 ? "text-red-600" : "text-slate-900"}>
                        {formatCurrency(balance)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={\`/vendors/\${v.id}\`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2")}>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
`);

w(`${B}/app/(dashboard)/vendors/[id]/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  RECORDED: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
};

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const vendor = await prisma.vendor.findFirst({
    where: { id, organizationId },
    include: {
      bills: { orderBy: { billDate: "desc" }, take: 20 },
    },
  });

  if (!vendor) notFound();

  const totalBilled = vendor.bills.reduce((s, b) => s + parseFloat(String(b.totalAmount)), 0);
  const totalPaid = vendor.bills.reduce((s, b) => s + parseFloat(String(b.amountPaid)), 0);
  const balance = totalBilled - totalPaid;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/vendors" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Vendors
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-semibold text-slate-900">{vendor.companyName}</span>
        <span className="font-mono text-xs text-slate-400">{vendor.vendorCode}</span>
        {vendor.isWhtEligible && (
          <Badge variant="outline" className="text-amber-600 border-amber-200">WHT</Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Billed", value: totalBilled, cls: "text-slate-900" },
          { label: "Total Paid", value: totalPaid, cls: "text-green-600" },
          { label: "Balance Owed", value: balance, cls: balance > 0 ? "text-red-600" : "text-slate-900" },
        ].map(({ label, value, cls }) => (
          <div key={label} className="border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className={\`text-2xl font-bold font-mono \${cls}\`}>{formatCurrency(value)}</p>
          </div>
        ))}
      </div>

      <div className="border border-slate-200 rounded-xl p-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-slate-500 mb-0.5">Contact</p>
          <p className="font-medium">{vendor.contactName || "—"}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Email</p>
          <p className="font-medium">{vendor.email || "—"}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Phone</p>
          <p className="font-medium">{vendor.phone || "—"}</p>
        </div>
        <div>
          <p className="text-slate-500 mb-0.5">Payment Terms</p>
          <p className="font-medium">{vendor.paymentTerms} days</p>
        </div>
        {vendor.bankName && (
          <div>
            <p className="text-slate-500 mb-0.5">Bank</p>
            <p className="font-medium">{vendor.bankName}</p>
          </div>
        )}
        {vendor.bankAccount && (
          <div>
            <p className="text-slate-500 mb-0.5">Account Number</p>
            <p className="font-medium font-mono">{vendor.bankAccount}</p>
          </div>
        )}
        {vendor.address && (
          <div className="col-span-2">
            <p className="text-slate-500 mb-0.5">Address</p>
            <p className="font-medium">{vendor.address}</p>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">Recent Bills</h2>
          <Link href={\`/purchases/bills?vendor=\${vendor.id}\`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            View all
          </Link>
        </div>
        {vendor.bills.length === 0 ? (
          <div className="flex flex-col items-center py-10 border border-dashed border-slate-200 rounded-xl">
            <Receipt className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">No bills yet</p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Number</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Date</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Due</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Status</th>
                  <th className="text-right px-4 py-2.5 font-medium text-slate-500">Total</th>
                  <th className="text-right px-4 py-2.5 font-medium text-slate-500">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vendor.bills.map((b) => {
                  const bal = parseFloat(String(b.totalAmount)) - parseFloat(String(b.amountPaid));
                  return (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <Link href={\`/purchases/bills/\${b.id}\`} className="text-blue-600 hover:underline font-mono text-xs">
                          {b.billNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{formatDate(b.billDate)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{formatDate(b.dueDate)}</td>
                      <td className="px-4 py-2.5">
                        <span className={\`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium \${statusColors[b.status] || ""}\`}>
                          {b.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(parseFloat(String(b.totalAmount)))}</td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        <span className={bal > 0 ? "text-red-600" : "text-slate-400"}>{formatCurrency(bal)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
`);

console.log('\\n✅ Vendors done');
