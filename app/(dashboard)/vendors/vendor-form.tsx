"use client";

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
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Create Vendor"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
