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
      className="sg-button sg-button-secondary" aria-live="polite">
      <RefreshCw size={15} className={pending ? "animate-spin motion-reduce:animate-none" : ""} />
      {pending ? "Refreshing..." : "Refresh"}
    </Button>
  );
}
