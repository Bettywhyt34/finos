import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Tag, ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CategoryForm } from "./category-form";
import { cn } from "@/lib/utils";

export default async function CategoriesPage() {
  const session = await auth();
  const tenantId = session!.user.tenantId!;

  const categories = await prisma.itemCategory.findMany({
    where: { tenantId },
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
