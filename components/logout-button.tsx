"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronUp,
  LogOut,
  Settings,
  UserRound,
  Loader2,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();

  const menuRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      setEmail(user.email ?? "");

      setName(
        user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split("@")[0] ||
          "User"
      );

      setAvatarUrl(
        user.user_metadata?.avatar_url ||
          user.user_metadata?.picture ||
          null
      );

      setLoading(false);
    }

    loadUser();
  }, [supabase]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);

    await supabase.auth.signOut();

    router.push("/auth/login");
    router.refresh();
  }

  const initials =
    name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .substring(0, 2)
      .toUpperCase() || "U";

  if (loading) {
    return (
      <div className="flex items-center gap-3 px-3 py-3 text-zinc-500">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      {/* DROPDOWN */}
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/40">
          {/* USER INFO */}
          <div className="border-b border-zinc-800 px-4 py-4">
            <p className="truncate text-sm font-semibold text-white">
              {name}
            </p>

            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {email}
            </p>
          </div>

          {/* ACTIONS */}
          <div className="p-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/dashboard/settings");
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            >
              <UserRound size={17} />
              Edit profile
            </button>

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/dashboard/settings");
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            >
              <Settings size={17} />
              Settings
            </button>
          </div>

          <div className="border-t border-zinc-800 p-1.5">
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-red-400 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loggingOut ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <LogOut size={17} />
              )}

              {loggingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      )}

      {/* USER BUTTON */}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="
          flex w-full items-center gap-3 rounded-xl
          border border-transparent px-2 py-2
          text-left transition
          hover:border-zinc-800 hover:bg-zinc-900
        "
      >
        {/* AVATAR */}
        {avatarUrl ? (
          <div
            className="h-9 w-9 shrink-0 rounded-lg bg-cover bg-center"
            style={{ backgroundImage: `url("${avatarUrl}")` }}
          />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-sm font-semibold text-white">
            {initials}
          </div>
        )}

        {/* NAME */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">
            {name}
          </p>

          <p className="truncate text-xs text-zinc-500">
            {email}
          </p>
        </div>

        <ChevronUp
          size={16}
          className={`shrink-0 text-zinc-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
    </div>
  );
}