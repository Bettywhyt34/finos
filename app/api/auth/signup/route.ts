import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  const body  = await req.json().catch(() => null);
  const name  = typeof body?.name     === "string" ? body.name.trim()     : null;
  const email = typeof body?.email    === "string" ? body.email.trim().toLowerCase() : null;
  const pass  = typeof body?.password === "string" ? body.password         : null;

  if (!name || !email || !pass) {
    return NextResponse.json({ error: "Name, email and password are required." }, { status: 400 });
  }
  if (pass.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const hashed = await bcrypt.hash(pass, 12);
  await prisma.user.create({ data: { name, email, password: hashed } });

  return NextResponse.json({ ok: true });
}
