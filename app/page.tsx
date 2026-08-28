import { AuthButton } from "@/components/auth-button";
import Link from "next/link";
import { Suspense } from "react";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      {/* NAVBAR */}
      <nav className="border-b border-zinc-800">
        <div className="max-w-7xl mx-auto h-16 px-6 flex items-center justify-between">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight"
          >
            SentinelGrid
          </Link>

          <Suspense>
            <AuthButton />
          </Suspense>
        </div>
      </nav>

      {/* HERO */}
      <section className="max-w-7xl mx-auto px-6 py-32">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-emerald-400 mb-4">
            Infrastructure Monitoring Platform
          </p>

          <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
            Monitor everything.
            <br />
            Know before it breaks.
          </h1>

          <p className="mt-6 text-lg text-zinc-400 max-w-2xl">
            Monitor websites, APIs, servers, DNS, SSL certificates and
            infrastructure from a single dashboard.
          </p>

          <div className="flex gap-4 mt-8">
            <Link
              href="/auth/sign-up"
              className="bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-zinc-200 transition"
            >
              Get Started
            </Link>

            <Link
              href="/auth/login"
              className="border border-zinc-700 px-6 py-3 rounded-lg font-medium hover:bg-zinc-900 transition"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}