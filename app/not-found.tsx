import Link from "next/link";

import {
  ArrowLeft,
  LayoutDashboard,
  Radar,
} from "lucide-react";

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050608] px-6 text-white">

      {/* GRID BACKGROUND */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)
          `,
          backgroundSize: "52px 52px",
        }}
      />

      {/* GLOW */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.025] blur-[120px]" />

      <div className="pointer-events-none absolute -left-40 top-1/3 h-[400px] w-[400px] rounded-full bg-blue-500/[0.04] blur-[140px]" />

      <div className="pointer-events-none absolute -right-40 bottom-0 h-[400px] w-[400px] rounded-full bg-cyan-500/[0.03] blur-[140px]" />

      {/* BIG 404 */}
      <div className="pointer-events-none absolute select-none text-[220px] font-black tracking-tighter text-white/[0.015] sm:text-[320px]">
        404
      </div>

      {/* CONTENT */}
      <div className="relative z-10 flex max-w-xl flex-col items-center text-center">

        {/* ICON */}
        <div className="relative mb-8">
          <div className="absolute inset-0 rounded-full bg-white/10 blur-2xl" />

          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] shadow-2xl backdrop-blur-xl">
            <Radar
              size={34}
              strokeWidth={1.5}
              className="text-white"
            />
          </div>

          {/* PULSE */}
          <div className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-red-500">
            <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-75" />
          </div>
        </div>

        {/* STATUS */}
        <div className="mb-5 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />

          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/50">
            Route unavailable
          </span>
        </div>

        {/* TITLE */}
        <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
          Signal lost.
        </h1>

        {/* DESCRIPTION */}
        <p className="mt-5 max-w-md text-sm leading-6 text-white/45">
          SentinelGrid couldn't establish a connection to this route.
          The page may have been moved, removed, or never existed.
        </p>

        {/* ROUTE INFO */}
        <div className="mt-8 w-full max-w-md rounded-xl border border-white/[0.08] bg-white/[0.025] p-1 backdrop-blur-sm">
          <div className="flex items-center justify-between rounded-lg px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-red-500" />

              <span className="font-mono text-xs text-white/40">
                HTTP_ROUTE
              </span>
            </div>

            <span className="font-mono text-xs text-white/70">
              UNREACHABLE
            </span>
          </div>
        </div>

        {/* BUTTONS */}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">

          <Link
            href="/"
            className="group inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-white/70 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
          >
            <ArrowLeft
              size={16}
              className="transition-transform duration-200 group-hover:-translate-x-1"
            />

            Back home
          </Link>

          <Link
            href="/dashboard"
            className="group inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-black transition-all duration-200 hover:bg-white/90"
          >
            <LayoutDashboard size={16} />

            Open dashboard
          </Link>

        </div>

        {/* CODE */}
        <p className="mt-10 font-mono text-[10px] uppercase tracking-[0.25em] text-white/15">
          SentinelGrid // Route Resolution Failure
        </p>

      </div>

      {/* SCAN LINE */}
      <div className="pointer-events-none absolute left-0 top-1/2 h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

    </main>
  );
}