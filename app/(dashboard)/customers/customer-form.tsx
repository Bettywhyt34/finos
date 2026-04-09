"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCustomer } from "./actions";

export function CustomerForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await createCustomer(new FormData(e.currentTarget));
    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    toast.success("Customer created");
    setOpen(false);
    (e.target as HTMLFormElement).reset();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Customer
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Customer</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="customerCode">Customer Code *</Label>
                <Input id="customerCode" name="customerCode" placeholder="CUST-001" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companyName">Company Name *</Label>
                <Input id="companyName" name="companyName" placeholder="Acme Corp" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="contactName">Contact Name</Label>
                <Input id="contactName" name="contactName" placeholder="John Doe" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" placeholder="john@acme.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" placeholder="+234 800 000 0000" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paymentTerms">Payment Terms (days)</Label>
                <Input id="paymentTerms" name="paymentTerms" type="number" defaultValue="30" min="0" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billingAddress">Billing Address</Label>
              <Input id="billingAddress" name="billingAddress" placeholder="123 Main St, Lagos" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="creditLimit">Credit Limit (₦)</Label>
              <Input id="creditLimit" name="creditLimit" type="number" step="0.01" placeholder="0.00" />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <DialogFooter className="pt-2">
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving…" : "Create Customer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
