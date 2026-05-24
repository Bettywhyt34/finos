import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase-server";

const BUCKET = "org-logos";
const MAX_SIZE = 1024 * 1024; // 1 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/bmp", "image/webp"];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File exceeds 1 MB limit" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() ?? "png";
  const path = `${tenantId}/logo.${ext}`;

  const supabase = createAdminClient();

  // Upload (upsert — overwrite any existing logo)
  const bytes = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Get public URL
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = `${data.publicUrl}?t=${Date.now()}`; // cache-bust

  // Persist to tenant row
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { logoUrl: publicUrl },
  });

  return NextResponse.json({ url: publicUrl });
}

export async function DELETE(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = session.user.tenantId;

  const supabase = createAdminClient();

  // List files with prefix to find the extension
  const { data: files } = await supabase.storage.from(BUCKET).list(tenantId);
  const toDelete = (files ?? []).map((f) => `${tenantId}/${f.name}`);
  if (toDelete.length > 0) {
    await supabase.storage.from(BUCKET).remove(toDelete);
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { logoUrl: null },
  });

  return NextResponse.json({ ok: true });
}
