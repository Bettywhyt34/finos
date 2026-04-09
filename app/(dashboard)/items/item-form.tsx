"use client";

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
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Create Item"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
