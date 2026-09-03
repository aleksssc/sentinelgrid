import Image from "next/image";

export default function Loading() {
  return (
    <main
      className="
        fixed inset-0 z-[9999]
        flex items-center justify-center
        overflow-hidden
        bg-[#09090b]
      "
    >
      {/* GRID */}

      <div
        className="
          pointer-events-none
          absolute inset-0
          opacity-[0.28]

          [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)]
          [background-size:52px_52px]
        "
      />

      {/* GLOW */}

      <div
        className="
          pointer-events-none
          absolute left-1/2 top-1/2

          h-[500px] w-[500px]

          -translate-x-1/2
          -translate-y-1/2

          rounded-full

          bg-cyan-500/[0.04]

          blur-[120px]
        "
      />

      {/* CONTENT */}

      <div className="relative z-10 flex flex-col items-center">

        <div
          className="
            relative

            flex h-16 w-16
            items-center justify-center

            rounded-2xl

            border border-white/[0.08]
            bg-white/[0.04]

            shadow-[0_20px_60px_rgba(0,0,0,0.4)]
          "
        >
          <Image
            src="/logos/sentinelgrid_png.png"
            alt="SentinelGrid"
            width={36}
            height={36}
            priority
            className="h-9 w-9 object-contain"
          />

          <span
            className="
              absolute inset-0
              animate-ping
              rounded-2xl
              border border-white/[0.07]
              opacity-30
            "
          />
        </div>

        <p
          className="
            mt-5

            text-sm font-medium
            tracking-tight

            text-zinc-300
          "
        >
          SentinelGrid
        </p>

        <div className="mt-4 flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />

          <span
            className="
              h-1.5 w-1.5
              animate-pulse
              rounded-full
              bg-zinc-500
              [animation-delay:150ms]
            "
          />

          <span
            className="
              h-1.5 w-1.5
              animate-pulse
              rounded-full
              bg-zinc-600
              [animation-delay:300ms]
            "
          />
        </div>

      </div>
    </main>
  );
}