"use client";

import { CheckCircle2, CircleAlert, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import type { ActionNotice } from "@/lib/remote/action-feedback";

const styles = {
  success: { icon: CheckCircle2, border: "border-emerald-500/20 bg-emerald-500/[0.06]", color: "text-emerald-400" },
  info: { icon: Info, border: "border-sky-500/20 bg-sky-500/[0.06]", color: "text-sky-400" },
  progress: { icon: LoaderCircle, border: "border-amber-500/20 bg-amber-500/[0.06]", color: "text-amber-400" },
  warning: { icon: TriangleAlert, border: "border-amber-500/20 bg-amber-500/[0.06]", color: "text-amber-400" },
  error: { icon: CircleAlert, border: "border-red-500/20 bg-red-500/[0.06]", color: "text-red-400" },
};

export default function DeviceActionNotice({ notice, onDismiss }: { notice: ActionNotice; onDismiss: () => void }) {
  const { icon: Icon, border, color } = styles[notice.tone];
  return (
    <div role={notice.tone === "error" ? "alert" : "status"} aria-atomic="true"
      className={`mt-5 flex items-start gap-3 rounded-xl border px-4 py-3 animate-in fade-in-0 slide-in-from-top-1 duration-150 motion-reduce:animate-none ${border}`}>
      <Icon size={17} aria-hidden="true" className={`mt-0.5 shrink-0 ${color} ${notice.tone === "progress" ? "animate-spin motion-reduce:animate-none" : ""}`} />
      <div className="min-w-0 flex-1">
        <p className={`break-words text-xs font-semibold ${color}`}>{notice.title}</p>
        <p className="mt-1 break-words text-xs leading-relaxed text-zinc-400">{notice.message}</p>
        {notice.code && <p className="mt-1.5 break-all font-mono text-[10px] text-zinc-500">{notice.code}</p>}
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss action notification"
        className="-mr-1 -mt-1 rounded-md p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200 focus-visible:outline focus-visible:outline-emerald-500">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
