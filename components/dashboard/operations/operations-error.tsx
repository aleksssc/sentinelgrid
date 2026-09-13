"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OperationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[Operations] Page failed:", error); }, [error]);
  return (
    <section role="alert" className="sg-surface sg-danger m-6 p-8 sm:m-8">
      <TriangleAlert size={24} className="text-red-400" />
      <h2 className="sg-section-title mt-4 text-white">Operations could not be loaded</h2>
      <p className="mt-2 text-sm text-zinc-400">Your data has not been changed. Retry to load the latest records.</p>
      <Button variant="outline" onClick={reset} className="sg-button sg-button-ghost mt-5">Try again</Button>
    </section>
  );
}
