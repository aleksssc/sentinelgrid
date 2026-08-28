"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Eye,
  EyeOff,
  Loader2,
  LogIn,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  async function handleLogin(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setLoading(true);
    setError("");

    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div>
      {/* HEADER */}

      <div className="mb-8 text-center">
        <div className="mb-3 text-sm font-medium text-emerald-400">
          Welcome back
        </div>

        <h1 className="text-3xl font-bold tracking-tight">
          Sign in to SentinelGrid
        </h1>

        <p className="mt-2 text-sm text-zinc-500">
          Monitor and manage your infrastructure.
        </p>
      </div>

      {/* CARD */}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-7">

        <form
          onSubmit={handleLogin}
          className="space-y-5"
        >

          {/* EMAIL */}

          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-medium text-zinc-300"
            >
              Email
            </label>

            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="you@example.com"
              className="
                w-full rounded-xl
                border border-zinc-700
                bg-zinc-950
                px-4 py-3
                text-white
                outline-none
                transition
                placeholder:text-zinc-700
                focus:border-zinc-500
              "
            />
          </div>

          {/* PASSWORD */}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                htmlFor="password"
                className="text-sm font-medium text-zinc-300"
              >
                Password
              </label>

              <Link
                href="/auth/forgot-password"
                className="text-xs text-zinc-500 transition hover:text-white"
              >
                Forgot password?
              </Link>
            </div>

            <div className="relative">

              <input
                id="password"
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value
                  )
                }
                className="
                  w-full rounded-xl
                  border border-zinc-700
                  bg-zinc-950
                  px-4 py-3 pr-12
                  text-white
                  outline-none
                  transition
                  focus:border-zinc-500
                "
              />

              <button
                type="button"
                onClick={() =>
                  setShowPassword(
                    (current) => !current
                  )
                }
                className="
                  absolute right-3 top-1/2
                  -translate-y-1/2
                  rounded-lg p-1.5
                  text-zinc-500
                  transition
                  hover:bg-zinc-800
                  hover:text-white
                "
              >
                {showPassword ? (
                  <EyeOff size={17} />
                ) : (
                  <Eye size={17} />
                )}
              </button>

            </div>
          </div>

          {/* ERROR */}

          {error && (
            <div className="rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* SUBMIT */}

          <button
            type="submit"
            disabled={loading}
            className="
              flex w-full items-center
              justify-center gap-2
              rounded-xl bg-white
              px-4 py-3
              font-medium text-black
              transition
              hover:bg-zinc-200
              disabled:cursor-not-allowed
              disabled:opacity-50
            "
          >
            {loading ? (
              <>
                <Loader2
                  size={17}
                  className="animate-spin"
                />
                Signing in...
              </>
            ) : (
              <>
                <LogIn size={17} />
                Sign in
              </>
            )}
          </button>

        </form>

        {/* SIGN UP */}

        <div className="mt-6 border-t border-zinc-800 pt-6 text-center text-sm text-zinc-500">
          Don&apos;t have an account?{" "}

          <Link
            href="/auth/sign-up"
            className="font-medium text-white transition hover:text-zinc-300"
          >
            Create account
          </Link>
        </div>

      </div>
    </div>
  );
}