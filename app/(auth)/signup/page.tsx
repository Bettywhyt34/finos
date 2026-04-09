"use client";

import { useState, useMemo } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
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

// Password rules
const RULES = [
  { label: "At least 8 characters",       test: (p: string) => p.length >= 8 },
  { label: "One uppercase letter (A–Z)",   test: (p: string) => /[A-Z]/.test(p) },
  { label: "One lowercase letter (a–z)",   test: (p: string) => /[a-z]/.test(p) },
  { label: "One number (0–9)",             test: (p: string) => /\d/.test(p) },
  { label: "One special character (!@#…)", test: (p: string) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(p) },
];

function strengthLabel(passed: number) {
  if (passed <= 1) return { label: "Very weak", color: "bg-red-500",    width: "w-1/5" };
  if (passed === 2) return { label: "Weak",      color: "bg-orange-400", width: "w-2/5" };
  if (passed === 3) return { label: "Fair",       color: "bg-yellow-400", width: "w-3/5" };
  if (passed === 4) return { label: "Good",       color: "bg-blue-500",   width: "w-4/5" };
  return               { label: "Strong",     color: "bg-green-500",  width: "w-full" };
}

export default function SignupPage() {
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [touched,  setTouched]  = useState(false);

  const ruleResults = useMemo(() => RULES.map((r) => r.test(password)), [password]);
  const passedCount = ruleResults.filter(Boolean).length;
  const allPassed   = passedCount === RULES.length;
  const strength    = strengthLabel(passedCount);

  const passwordsMatch = password === confirm;
  const canSubmit = allPassed && passwordsMatch && name.trim() && email.trim() && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!allPassed) { setError("Please meet all password requirements."); return; }
    if (!passwordsMatch) { setError("Passwords do not match."); return; }

    setLoading(true);
    setError("");

    const res  = await fetch("/api/auth/signup", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name, email, password }),
    });
    const data = await res.json().catch(() => ({ error: "Unexpected server error." }));

    if (!res.ok) {
      setError(data.error ?? "Sign up failed. Please try again.");
      setLoading(false);
      return;
    }

    // Auto sign-in then go to org creation
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError("Account created but sign-in failed. Please go to login.");
      setLoading(false);
    } else {
      window.location.href = "/register";
    }
  }

  return (
    <Card className="w-[420px] shadow-lg">
      <CardHeader className="space-y-1">
        <div className="text-3xl font-bold tracking-tight">FINOS</div>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>
          Sign up to get started, then set up your workspace.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-1">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              required
              minLength={2}
            />
          </div>

          {/* Email */}
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          {/* Password */}
          <div className="space-y-1">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setTouched(true); }}
              placeholder="Create a strong password"
              required
            />

            {/* Strength bar */}
            {password.length > 0 && (
              <div className="space-y-1.5 mt-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${strength.color} ${strength.width}`} />
                  </div>
                  <span className="text-xs text-slate-500 w-16 text-right">{strength.label}</span>
                </div>

                {/* Rule checklist */}
                <ul className="space-y-0.5">
                  {RULES.map((rule, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-xs">
                      {ruleResults[i] ? (
                        <span className="text-green-500">✓</span>
                      ) : (
                        <span className="text-slate-300">○</span>
                      )}
                      <span className={ruleResults[i] ? "text-green-600" : "text-slate-400"}>
                        {rule.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Confirm password */}
          <div className="space-y-1">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              required
            />
            {touched && confirm.length > 0 && !passwordsMatch && (
              <p className="text-xs text-red-500 mt-1">Passwords do not match.</p>
            )}
            {touched && confirm.length > 0 && passwordsMatch && (
              <p className="text-xs text-green-500 mt-1">✓ Passwords match.</p>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-4">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-slate-900 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
