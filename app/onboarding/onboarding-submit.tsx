"use client";

import Image from "next/image";
import { useFormStatus } from "react-dom";

import {
  ArrowRight,
  Loader2,
} from "lucide-react";

export default function OnboardingSubmit() {
  const { pending } = useFormStatus();

  return (
    <>
      <button
        type="submit"
        disabled={pending}
        className="
          inline-flex h-9
          items-center justify-center
          gap-2

          rounded-xl
          bg-white
          px-4

          text-sm font-medium
          text-zinc-950

          transition-all duration-200

          hover:bg-zinc-200
          active:scale-[0.98]

          disabled:cursor-not-allowed
          disabled:opacity-70
        "
      >
        {pending ? (
          <>
            <Loader2
              size={15}
              className="animate-spin"
            />

            Setting up...
          </>
        ) : (
          <>
            Continue

            <ArrowRight size={15} />
          </>
        )}
      </button>

      {/* ======================================================
          FULL SCREEN LOADING
      ====================================================== */}

      {pending && (
        <div
          className="
            fixed inset-0 z-[9999]

            flex items-center justify-center

            bg-[#09090b]

            backdrop-blur-xl

            animate-in
            fade-in
            duration-300
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

              h-[450px] w-[450px]

              -translate-x-1/2
              -translate-y-1/2

              rounded-full

              bg-cyan-500/[0.04]

              blur-[110px]
            "
          />

          {/* CONTENT */}

          <div className="relative z-10 flex flex-col items-center">

            {/* LOGO */}

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
                className="
                  h-9 w-9
                  object-contain
                "
              />

              {/* PULSE */}

              <span
                className="
                  absolute inset-0

                  animate-ping

                  rounded-2xl

                  border border-white/[0.06]

                  opacity-40
                "
              />
            </div>

            {/* TEXT */}

            <h2
              className="
                mt-6

                text-lg font-semibold
                tracking-tight

                text-white
              "
            >
              Preparing SentinelGrid
            </h2>

            <p
              className="
                mt-2

                text-sm
                text-zinc-500
              "
            >
              Setting up your workspace
            </p>

            {/* LOADER */}

            <div className="mt-6 flex items-center gap-2">

              <span
                className="
                  h-1.5 w-1.5
                  animate-pulse
                  rounded-full
                  bg-zinc-400
                "
              />

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
        </div>
      )}
    </>
  );
}