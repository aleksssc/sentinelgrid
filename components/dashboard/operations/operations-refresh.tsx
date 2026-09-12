"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OperationsRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => startTransition(() => router.refresh())}
      className="h-10 rounded-xl border-white/10 bg-[#0d0f12] text-zinc-300 hover:bg-white/5 hover:text-white" aria-live="polite">
      <RefreshCw size={15} className={pending ? "animate-spin motion-reduce:animate-none" : ""} />
      {pending ? "Refreshing..." : "Refresh"}
    </Button>
  );
}
