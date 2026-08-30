"use client";

import {
  FormEvent,
  useState,
} from "react";

import { useRouter } from "next/navigation";

import {
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

import {
  acceptOrganizationInvite,
} from "./actions";

type InviteSetupFormProps = {
  token: string;
  email: string;
  organizationName: string;
};

export default function InviteSetupForm({
  token,
  email,
  organizationName,
}: InviteSetupFormProps) {
  const router = useRouter();

  const supabase = createClient();

  const [password, setPassword] =
    useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [
    showPassword,
    setShowPassword,
  ] = useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] = useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError(null);

    if (password.length < 8) {
      setError(
        "Password must contain at least 8 characters."
      );

      return;
    }

    if (
      password !==
      confirmPassword
    ) {
      setError(
        "Passwords do not match."
      );

      return;
    }

    setLoading(true);

    /* =========================
       1. SET PASSWORD
    ========================= */

    const {
      error: passwordError,
    } =
      await supabase.auth.updateUser({
        password,
      });

    if (passwordError) {
      console.error(
        "Password error:",
        passwordError
      );

      setError(
        passwordError.message
      );

      setLoading(false);

      return;
    }

    /* =========================
       2. ACCEPT ORGANIZATION
       INVITATION
    ========================= */

    const result =
      await acceptOrganizationInvite(
        token
      );

    if (
      !result.success ||
      !result.organizationId
    ) {
      setError(
        result.error ??
          "Unable to accept invitation."
      );

      setLoading(false);

      return;
    }

    /* =========================
       3. REMOVE TEMP INVITE
       METADATA
    ========================= */

    const {
      error: metadataError,
    } =
      await supabase.auth.updateUser({
        data: {
          organization_invite_token:
            null,

          organization_id:
            null,

          organization_name:
            null,

          organization_role:
            null,
        },
      });

    if (metadataError) {
      console.error(
        "Metadata cleanup error:",
        metadataError
      );

      // Não bloqueamos o acesso.
      // O membership já foi criado.
    }

    /* =========================
       4. GO TO ORGANIZATION
    ========================= */

    router.replace(
      `/dashboard/organizations/${result.organizationId}`
    );

    router.refresh();
  }

  return (
    <div className="w-full max-w-md">

      <div className="mb-8 text-center">

        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10">
          <ShieldCheck
            size={22}
            className="text-blue-400"
          />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Welcome to SentinelGrid
        </h1>

        <p className="mt-2 text-sm leading-6 text-zinc-500">
          You&apos;ve been invited
          to join{" "}
          <span className="font-medium text-zinc-300">
            {organizationName}
          </span>
          .
        </p>

      </div>


      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-white/10 bg-white/[0.025] p-6"
      >

        {/* EMAIL */}

        <div className="mb-5">

          <label className="mb-2 block text-xs font-medium text-zinc-400">
            Email Address
          </label>

          <input
            type="email"
            value={email}
            disabled
            className="w-full cursor-not-allowed rounded-lg border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-zinc-500 outline-none"
          />

        </div>


        {/* PASSWORD */}

        <div className="mb-4">

          <label
            htmlFor="password"
            className="mb-2 block text-xs font-medium text-zinc-400"
          >
            Create Password
          </label>

          <div className="relative">

            <LockKeyhole
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
            />

            <input
              id="password"
              type={
                showPassword
                  ? "text"
                  : "password"
              }
              value={password}
              onChange={(event) =>
                setPassword(
                  event.target.value
                )
              }
              required
              autoComplete="new-password"
              placeholder="Minimum 8 characters"
              className="w-full rounded-lg border border-white/10 bg-black/20 py-2.5 pl-10 pr-10 text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-blue-500/60"
            />

            <button
              type="button"
              onClick={() =>
                setShowPassword(
                  (current) =>
                    !current
                )
              }
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 transition hover:text-zinc-300"
            >
              {showPassword ? (
                <EyeOff size={15} />
              ) : (
                <Eye size={15} />
              )}
            </button>

          </div>

        </div>


        {/* CONFIRM PASSWORD */}

        <div>

          <label
            htmlFor="confirmPassword"
            className="mb-2 block text-xs font-medium text-zinc-400"
          >
            Confirm Password
          </label>

          <div className="relative">

            <LockKeyhole
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
            />

            <input
              id="confirmPassword"
              type={
                showConfirmPassword
                  ? "text"
                  : "password"
              }
              value={
                confirmPassword
              }
              onChange={(event) =>
                setConfirmPassword(
                  event.target.value
                )
              }
              required
              autoComplete="new-password"
              placeholder="Repeat your password"
              className="w-full rounded-lg border border-white/10 bg-black/20 py-2.5 pl-10 pr-10 text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-blue-500/60"
            />

            <button
              type="button"
              onClick={() =>
                setShowConfirmPassword(
                  (current) =>
                    !current
                )
              }
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 transition hover:text-zinc-300"
            >
              {showConfirmPassword ? (
                <EyeOff size={15} />
              ) : (
                <Eye size={15} />
              )}
            </button>

          </div>

        </div>


        {/* ERROR */}

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2.5 text-xs leading-5 text-red-400">
            {error}
          </div>
        )}


        {/* SUBMIT */}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 flex w-full items-center justify-center rounded-lg bg-white py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading
            ? "Setting up account..."
            : "Complete Account Setup"}
        </button>

      </form>

    </div>
  );
}