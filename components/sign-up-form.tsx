"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Eye,
  EyeOff,
  Loader2,
  UserPlus,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export function SignUpForm() {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [showPassword, setShowPassword] =
    useState(false);

  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  async function handleSignUp(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");

    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }

    if (password.length < 8) {
      setError(
        "Password must contain at least 8 characters."
      );
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,

      options: {
        data: {
          full_name: name.trim(),
        },

        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/auth/sign-up-success");
  }

  return (
    <div>
      {/* HEADER */}

      <div className="mb-8 text-center">

        <div className="mb-3 text-sm font-medium text-emerald-400">
          Create your account
        </div>

        <h1 className="text-3xl font-bold tracking-tight">
          Join SentinelGrid
        </h1>

        <p className="mt-2 text-sm text-zinc-500">
          Start monitoring your infrastructure
          from one place.
        </p>

      </div>


      {/* CARD */}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-7">

        <form
          onSubmit={handleSignUp}
          className="space-y-5"
        >

          {/* NAME */}

          <div>
            <label
              htmlFor="name"
              className="mb-2 block text-sm font-medium text-zinc-300"
            >
              Display name
            </label>

            <input
              id="name"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder="Nome de Utilizador"
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

            <label
              htmlFor="password"
              className="mb-2 block text-sm font-medium text-zinc-300"
            >
              Password
            </label>

            <div className="relative">

              <input
                id="password"
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="Minimum 8 characters"
                className="
                  w-full rounded-xl
                  border border-zinc-700
                  bg-zinc-950
                  px-4 py-3 pr-12
                  text-white
                  outline-none
                  transition
                  placeholder:text-zinc-700
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


          {/* CONFIRM PASSWORD */}

          <div>

            <label
              htmlFor="confirm-password"
              className="mb-2 block text-sm font-medium text-zinc-300"
            >
              Confirm password
            </label>

            <div className="relative">

              <input
                id="confirm-password"
                type={
                  showConfirmPassword
                    ? "text"
                    : "password"
                }
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(
                    event.target.value
                  )
                }
                placeholder="Repeat your password"
                className="
                  w-full rounded-xl
                  border border-zinc-700
                  bg-zinc-950
                  px-4 py-3 pr-12
                  text-white
                  outline-none
                  transition
                  placeholder:text-zinc-700
                  focus:border-zinc-500
                "
              />

              <button
                type="button"
                onClick={() =>
                  setShowConfirmPassword(
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
                {showConfirmPassword ? (
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

                Creating account...
              </>
            ) : (
              <>
                <UserPlus size={17} />

                Create account
              </>
            )}
          </button>

        </form>


        {/* LOGIN */}

        <div className="mt-6 border-t border-zinc-800 pt-6 text-center text-sm text-zinc-500">

          Already have an account?{" "}

          <Link
            href="/auth/login"
            className="font-medium text-white transition hover:text-zinc-300"
          >
            Sign in
          </Link>

        </div>

      </div>
    </div>
  );
}