import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">

      <header className="border-b border-zinc-800">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">

          {/* LOGO */}
          <Link
            href="/"
            className="flex items-center gap-2 font-bold"
          >
            <Image
              src="/logos/sentinelgrid_png.png"
              alt="SentinelGrid"
              width={32}
              height={32}
              className="h-8 w-8 object-contain"
            />

            <span className="text-lg">
              SentinelGrid
            </span>
          </Link>

          {/* NAV */}
          <div className="hidden items-center gap-8 md:flex">

            <Link
              href="/features"
              className="text-sm text-zinc-400 transition hover:text-white"
            >
              Features
            </Link>

            <Link
              href="/pricing"
              className="text-sm text-zinc-400 transition hover:text-white"
            >
              Pricing
            </Link>

            <Link
              href="/security"
              className="text-sm text-zinc-400 transition hover:text-white"
            >
              Security
            </Link>

            <Link
              href="/about"
              className="text-sm text-zinc-400 transition hover:text-white"
            >
              About
            </Link>

          </div>

          {/* AUTH */}
          <Suspense
            fallback={
              <div className="h-10 w-24 animate-pulse rounded-lg bg-white/5" />
            }
          >
            <AuthButton />
          </Suspense>

        </nav>
      </header>

      {children}

      <footer className="border-t border-zinc-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-8 text-sm text-zinc-600">

        <span>
          © 2026 SentinelGrid
        </span>
          <span>
            Infrastructure Monitoring Platform
          </span>

        </div>
      </footer>

    </div>
  );
}