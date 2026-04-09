import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const B = 'C:/Users/digit/Projects/finos/finos-v5';

function w(p, c) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, c, 'utf8');
  console.log('✓', p.replace(B, ''));
}

// ════════════════════════════════════════════════════════════
// ITEMS
// ════════════════════════════════════════════════════════════

w(`${B}/app/(dashboard)/items/actions.ts`, `"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function createItem(formData: FormData) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return { error: "Unauthorized" };

  const itemCode = String(formData.get("itemCode") || "").trim();
  const name = String(formData.get("name") || "").trim();
  if (!itemCode || !name) return { error: "Code and name are required" };

  const type = String(formData.get("type") || "SERVICE") as "INVENTORY" | "SERVICE" | "NON_STOCK";

  try {
    await prisma.item.create({
      data: {
        organizationId: orgId,
        itemCode,
        name,
        description: String(formData.get("description") || "") || null,
        type,
        categoryId: String(formData.get("categoryId") || "") || null,
        unit: String(formData.get("unit") || "each"),
        salesPrice: formData.get("salesPrice") ? parseFloat(String(formData.get("salesPrice"))) : null,
        costPrice: formData.get("costPrice") ? parseFloat(String(formData.get("costPrice"))) : null,
        incomeAccountId: String(formData.get("incomeAccountId") || "") || null,
        expenseAccountId: String(formData.get("expenseAccountId") || "") || null,
        assetAccountId: String(formData.get("assetAccountId") || "") || null,
      },
    });
    revalidatePath("/items");
    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) return { error: "Item code already exists" };
    return { error: msg };
  }
}

export async function createItemCategory(formData: FormData) {
  const session = await auth();
  const orgId = session?.user?.organizationId;
  if (!orgId) return { error: "Unauthorized" };

  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Name is required" };

  await prisma.itemCategory.create({
    data: {
      organizationId: orgId,
      name,
      parentId: String(formData.get("parentId") || "") || null,
    },
  });
  revalidatePath("/items/categories");
  return { success: true };
}
`);

w(`${B}/app/(dashboard)/items/item-form.tsx`, `"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createItem } from "./actions";

interface Category { id: string; name: string; }
interface Account { id: string; code: string; name: string; }

interface Props {
  categories: Category[];
  accounts: Account[];
}

export function ItemForm({ categories, accounts }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState("SERVICE");
  const [categoryId, setCategoryId] = useState("");
  const [incomeAccountId, setIncomeAccountId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [assetAccountId, setAssetAccountId] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("type", type);
    fd.set("categoryId", categoryId);
    fd.set("incomeAccountId", incomeAccountId);
    fd.set("expenseAccountId", expenseAccountId);
    fd.set("assetAccountId", assetAccountId);
    const result = await createItem(fd);
    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    toast.success("Item created");
    setOpen(false);
    setType("SERVICE");
    setCategoryId("");
    setIncomeAccountId("");
    setExpenseAccountId("");
    setAssetAccountId("");
    (e.target as HTMLFormElement).reset();
  }

  const incomeAccounts = accounts.filter((a) => a.code.startsWith("IN") || a.code.startsWith("RE"));
  const expenseAccounts = accounts.filter((a) => a.code.startsWith("EX") || a.code.startsWith("CO") || a.code.startsWith("OP"));
  const assetAccounts = accounts.filter((a) => a.code.startsWith("CA") || a.code.startsWith("FA"));

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Item
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Item</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="itemCode">Item Code *</Label>
                <Input id="itemCode" name="itemCode" placeholder="ITEM-001" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" name="name" placeholder="Professional Services" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Input id="description" name="description" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v ?? "SERVICE")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SERVICE">Service</SelectItem>
                    <SelectItem value="INVENTORY">Inventory</SelectItem>
                    <SelectItem value="NON_STOCK">Non-stock</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="unit">Unit</Label>
                <Input id="unit" name="unit" defaultValue="each" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="salesPrice">Sales Price</Label>
                <Input id="salesPrice" name="salesPrice" type="number" step="0.01" placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="costPrice">Cost Price</Label>
                <Input id="costPrice" name="costPrice" type="number" step="0.01" placeholder="0.00" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Income Account</Label>
              <Select value={incomeAccountId} onValueChange={(v) => setIncomeAccountId(v ?? "")}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {incomeAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Expense Account</Label>
              <Select value={expenseAccountId} onValueChange={(v) => setExpenseAccountId(v ?? "")}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {expenseAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {type === "INVENTORY" && (
              <div className="space-y-1.5">
                <Label>Asset Account</Label>
                <Select value={assetAccountId} onValueChange={(v) => setAssetAccountId(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {assetAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <DialogFooter className="pt-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Create Item"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
`);

w(`${B}/app/(dashboard)/items/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Package, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ItemForm } from "./item-form";
import { formatCurrency, cn } from "@/lib/utils";

const typeColors: Record<string, string> = {
  INVENTORY: "bg-blue-100 text-blue-700",
  SERVICE: "bg-purple-100 text-purple-700",
  NON_STOCK: "bg-slate-100 text-slate-600",
};

export default async function ItemsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const [items, categories, accounts] = await Promise.all([
    prisma.item.findMany({
      where: { organizationId, isActive: true },
      include: { category: true },
      orderBy: { name: "asc" },
    }),
    prisma.itemCategory.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    }),
    prisma.chartOfAccounts.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Items</h1>
          <p className="text-sm text-slate-500 mt-1">
            {items.length} item{items.length !== 1 ? "s" : ""} ·{" "}
            <Link href="/items/categories" className="hover:underline text-blue-600">Manage categories</Link>
          </p>
        </div>
        <ItemForm categories={categories} accounts={accounts} />
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <Package className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No items yet</p>
          <p className="text-sm text-slate-400">Add products and services to your catalog.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Code</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Type</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">Category</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Sales Price</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">Cost Price</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.itemCode}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{item.name}</td>
                  <td className="px-4 py-3">
                    <span className={\`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium \${typeColors[item.type] || ""}\`}>
                      {item.type.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{item.category?.name || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {item.salesPrice ? formatCurrency(parseFloat(String(item.salesPrice))) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {item.costPrice ? formatCurrency(parseFloat(String(item.costPrice))) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={\`/items/\${item.id}\`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2")}>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
`);

w(`${B}/app/(dashboard)/items/categories/category-form.tsx`, `"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createItemCategory } from "../actions";

interface Category { id: string; name: string; }

export function CategoryForm({ categories }: { categories: Category[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parentId, setParentId] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("parentId", parentId);
    const result = await createItemCategory(fd);
    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    toast.success("Category created");
    setOpen(false);
    setParentId("");
    (e.target as HTMLFormElement).reset();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Category
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Category</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Category Name *</Label>
              <Input id="name" name="name" placeholder="e.g. Software, Hardware" required />
            </div>
            <div className="space-y-1.5">
              <Label>Parent Category</Label>
              <Select value={parentId} onValueChange={(v) => setParentId(v ?? "")}>
                <SelectTrigger><SelectValue placeholder="None (top-level)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None (top-level)</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <DialogFooter className="pt-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
`);

w(`${B}/app/(dashboard)/items/categories/page.tsx`, `import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Tag, ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CategoryForm } from "./category-form";
import { cn } from "@/lib/utils";

export default async function CategoriesPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;

  const categories = await prisma.itemCategory.findMany({
    where: { organizationId },
    include: {
      parent: true,
      children: true,
      items: { select: { id: true } },
    },
    orderBy: { name: "asc" },
  });

  const topLevel = categories.filter((c) => !c.parentId);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/items" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Items
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-semibold text-slate-900">Categories</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Item Categories</h1>
          <p className="text-sm text-slate-500 mt-1">{categories.length} categories</p>
        </div>
        <CategoryForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      {categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-slate-200 rounded-xl">
          <Tag className="h-10 w-10 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium mb-1">No categories yet</p>
          <p className="text-sm text-slate-400">Organise your items with categories.</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          {topLevel.map((parent) => (
            <div key={parent.id}>
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-slate-400" />
                  <span className="font-medium text-slate-900">{parent.name}</span>
                </div>
                <span className="text-xs text-slate-400">{parent.items.length} items</span>
              </div>
              {parent.children.length > 0 && parent.children.map((child) => {
                const full = categories.find((c) => c.id === child.id);
                return (
                  <div key={child.id} className="flex items-center justify-between px-4 py-2.5 pl-10 border-b border-slate-100 last:border-0">
                    <span className="text-sm text-slate-700">{child.name}</span>
                    <span className="text-xs text-slate-400">{full?.items.length ?? 0} items</span>
                  </div>
                );
              })}
            </div>
          ))}
          {categories.filter((c) => !c.parentId && c.children.length === 0).length === 0 && topLevel.length === 0 && (
            categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0">
                <span className="font-medium text-slate-900">{c.name}</span>
                <span className="text-xs text-slate-400">{c.items.length} items</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
`);

console.log('\n✅ Items + Categories done');
