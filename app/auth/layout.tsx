import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Activity } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">

      {/* HEADER */}
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">

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

          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white"
          >
            <ArrowLeft size={16} />
            Back to home
          </Link>

        </div>
      </header>

      {/* CONTENT */}
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-6 py-12">
        {children}
      </div>

    </div>
  );
}