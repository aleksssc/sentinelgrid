import Link from "next/link";
import "./style.css";
import {
  Activity,
  Server,
  Globe2,
  TriangleAlert,
} from "lucide-react";

export default function Home() {
  return (
    <main>

      {/* =========================================================
                          HERO
      ========================================================== */}

      <section className="relative overflow-hidden border-b border-zinc-800">

        {/* ANIMATED BACKGROUND */}
        <div className="pointer-events-none absolute inset-0">

          <div className="hero-grid absolute inset-0" />

          <div className="hero-glow hero-glow-one" />
          <div className="hero-glow hero-glow-two" />

          <div className="hero-scan-line" />

        </div>

        {/* CONTENT */}
        <div className="relative z-10 mx-auto max-w-7xl px-6 py-36">

          <div className="max-w-3xl">

            <p className="mb-5 text-sm font-medium text-emerald-400">
              Infrastructure Monitoring Platform
            </p>

            <h1 className="text-5xl font-bold tracking-tight md:text-6xl lg:text-7xl">
              Monitor everything.
              <br />
              Know before it breaks.
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-zinc-400">
              Monitor websites, APIs, servers, DNS, SSL certificates and
              infrastructure from a single dashboard.
            </p>

            <div className="mt-9 flex gap-4">

              <Link
                href="/auth/sign-up"
                className="rounded-xl bg-white px-7 py-3.5 font-medium text-black transition hover:bg-zinc-200"
              >
                Get Started
              </Link>

              <Link
                href="/auth/login"
                className="rounded-xl border border-zinc-700 bg-zinc-950/40 px-7 py-3.5 font-medium text-white backdrop-blur transition hover:bg-zinc-900"
              >
                Sign In
              </Link>

            </div>

          </div>

        </div>

      </section>


      {/* =========================================================
                          FEATURES
      ========================================================== */}

      <section className="border-b border-zinc-800">

        <div className="mx-auto max-w-7xl px-6 py-28">

          <div className="mb-14 max-w-2xl">

            <p className="mb-4 text-sm font-medium text-emerald-400">
              Everything in one place
            </p>

            <h2 className="text-4xl font-bold tracking-tight">
              One platform for your entire infrastructure.
            </h2>

            <p className="mt-5 text-lg leading-8 text-zinc-400">
              Stop switching between multiple tools to monitor websites,
              servers, domains and services.
            </p>

          </div>


          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">

            <FeatureCard
              icon={<Activity size={22} />}
              title="Website Monitoring"
              description="Track uptime, response times and HTTP status automatically."
            />

            <FeatureCard
              icon={<Server size={22} />}
              title="Server Monitoring"
              description="Monitor CPU, memory, disks and critical services."
            />

            <FeatureCard
              icon={<Globe2 size={22} />}
              title="DNS & Domains"
              description="Track DNS, SSL certificates and domain configuration."
            />

            <FeatureCard
              icon={<TriangleAlert size={22} />}
              title="Incident Management"
              description="Detect outages, record incidents and get notified."
            />

          </div>

        </div>

      </section>

    </main>
  );
}


function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div
      className="
        group rounded-2xl
        border border-zinc-800
        bg-zinc-900/50
        p-7
        transition duration-300
        hover:-translate-y-1
        hover:border-zinc-700
        hover:bg-zinc-900
      "
    >

      <div
        className="
          mb-7 flex h-11 w-11
          items-center justify-center
          rounded-xl
          border border-zinc-700
          bg-zinc-800
          text-zinc-300
          transition
          group-hover:border-emerald-500/30
          group-hover:bg-emerald-500/10
          group-hover:text-emerald-400
        "
      >
        {icon}
      </div>

      <h3 className="text-lg font-semibold">
        {title}
      </h3>

      <p className="mt-3 text-sm leading-6 text-zinc-500">
        {description}
      </p>

    </div>
  );
}