"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { reverseFXRevaluation } from "../actions";
import { toast } from "sonner";

export function ReverseButton({ revalId }: { revalId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleReverse() {
    if (!confirm("Post a reversing journal entry for this revaluation?")) return;
    startTransition(async () => {
      const result = await reverseFXRevaluation(revalId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Revaluation reversed");
        router.refresh();
      }
    });
  }

  return (
    <Button type="button" variant="outline" onClick={handleReverse} disabled={isPending}>
      {isPending ? "Reversing..." : "Reverse"}
    </Button>
  );
}
