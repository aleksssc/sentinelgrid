import Link from "next/link";
import { LayoutDashboard, LogIn, UserPlus } from "lucide-react";

import { createClient } from "@/lib/supabase/server";

export async function AuthButton() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // USER LOGGED IN
  if (user) {
    return (
      <Link
        href="/dashboard"
        className="
          flex items-center gap-2
          rounded-lg
          bg-white
          px-4 py-2
          text-sm font-medium text-black
          transition
          hover:bg-zinc-200
        "
      >
        <LayoutDashboard size={16} />
        Dashboard
      </Link>
    );
  }

  // USER NOT LOGGED IN
  return (
    <div className="flex items-center gap-2">

      <Link
        href="/auth/login"
        className="
          flex items-center gap-2
          rounded-lg
          px-4 py-2
          text-sm font-medium text-zinc-300
          transition
          hover:bg-zinc-900
          hover:text-white
        "
      >
        <LogIn size={16} />
        Sign in
      </Link>

      <Link
        href="/auth/sign-up"
        className="
          flex items-center gap-2
          rounded-lg
          bg-white
          px-4 py-2
          text-sm font-medium text-black
          transition
          hover:bg-zinc-200
        "
      >
        <UserPlus size={16} />
        Get started
      </Link>

    </div>
  );
}