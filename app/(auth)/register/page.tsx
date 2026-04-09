"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { createOrganization } from "@/lib/actions/organization";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function RegisterPage() {
  const { update } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = await createOrganization(formData);

    if (result?.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    // Refresh the JWT so it picks up the new organizationId + role
    await update();
    router.push("/");
    router.refresh();
  }

  return (
    <Card className="w-[440px] shadow-lg">
      <CardHeader className="space-y-1">
        <div className="text-2xl font-bold tracking-tight">FINOS</div>
        <CardTitle className="text-xl">Create your organization</CardTitle>
        <CardDescription>
          Set up your financial workspace. You can invite team members later.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Organization name</Label>
            <Input
              id="name"
              name="name"
              placeholder="Acme Corp"
              required
              minLength={2}
              maxLength={100}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              This is your company or business name.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-md">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating workspace…" : "Create workspace"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
