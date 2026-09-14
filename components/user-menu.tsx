"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, CreditCard, Loader2, LogOut, Settings2, Shield, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type PlatformRole = "platform_admin" | "developer";
function platformRole(value: unknown): value is PlatformRole { return value === "platform_admin" || value === "developer"; }

export function UserMenu() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [plan, setPlan] = useState("Free");
  const [role, setRole] = useState<PlatformRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadUser() {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user || !active) return;

        setEmail(user.email ?? "");
        setName(user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "User");
        setAvatarUrl(user.user_metadata?.avatar_url || user.user_metadata?.picture || null);
        setRole(platformRole(user.app_metadata.platform_role) ? user.app_metadata.platform_role : null);

        const { data: subscription, error: subscriptionError } = await supabase
          .from("account_subscriptions")
          .select("plan")
          .eq("user_id", user.id)
          .maybeSingle();
        if (subscriptionError) console.error("User menu subscription error:", subscriptionError);
        if (active && subscription?.plan) setPlan(subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1));
      } catch (error) {
        console.error("User menu load error:", error);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadUser();
    return () => { active = false; };
  }, [supabase]);

  useEffect(() => {
    function close(event: MouseEvent) { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);

  useEffect(() => {
    function update(event: Event) {
      const data = (event as CustomEvent<{ name?: string; email?: string; avatarUrl?: string | null }>).detail;
      if (data.name !== undefined) setName(data.name);
      if (data.email !== undefined) setEmail(data.email);
      if (data.avatarUrl !== undefined) setAvatarUrl(data.avatarUrl);
    }
    window.addEventListener("sentinelgrid-profile-updated", update);
    return () => window.removeEventListener("sentinelgrid-profile-updated", update);
  }, []);

  async function logout() {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  const initials = name.split(" ").map((word) => word[0]).join("").substring(0, 2).toUpperCase() || "U";
  if (loading) return <div className="flex h-10 items-center gap-2 px-2 text-zinc-500"><Loader2 size={16} className="animate-spin" /><span className="hidden text-xs sm:inline">Loading...</span></div>;
  const navigate = (href: string) => { setOpen(false); router.push(href); };

  return <div ref={menuRef} className="relative"><button type="button" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex h-11 max-w-[270px] items-center gap-3 rounded-xl border border-transparent px-2.5 text-left outline-none transition hover:border-surface-accent-edge hover:bg-surface-hover focus-visible:border-surface-accent-edge">
    {avatarUrl ? <div className="h-8 w-8 shrink-0 rounded-lg bg-cover bg-center" style={{ backgroundImage: `url(\"${avatarUrl}\")` }} /> : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-xs font-semibold text-white">{initials}</div>}
    <div className="hidden min-w-0 flex-1 md:block"><p className="truncate text-sm font-medium text-white">{name}</p><p className="truncate text-[11px] text-zinc-500">{plan} Plan</p></div><ChevronDown size={15} className={`shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
  </button>{open && <div className="sg-account-dropdown absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-zinc-800 bg-surface shadow-2xl shadow-black/50"><div className="border-b border-zinc-800 px-4 py-4"><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-semibold text-white">{name}</p><span className="shrink-0 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-300">{plan}</span></div><p className="mt-1 truncate text-xs text-zinc-500">{email}</p></div><div className="p-1.5">
    <MenuButton icon={<UserRound size={17} />} onClick={() => navigate("/dashboard/profile")}>Edit profile</MenuButton><MenuButton icon={<Settings2 size={17} />} onClick={() => navigate("/dashboard/settings")}>Settings</MenuButton><MenuButton icon={<CreditCard size={17} />} onClick={() => navigate("/dashboard/billing")}>Billing</MenuButton>
    {role && <><div className="my-1 border-t border-zinc-800" /><MenuButton icon={<Shield size={17} />} onClick={() => navigate("/admin")}>Platform Admin</MenuButton></>}
  </div><div className="border-t border-zinc-800 p-1.5"><button type="button" onClick={logout} disabled={loggingOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-red-400 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50">{loggingOut ? <Loader2 size={17} className="animate-spin" /> : <LogOut size={17} />}{loggingOut ? "Signing out..." : "Sign out"}</button></div></div>}</div>;
}

function MenuButton({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-300 transition hover:bg-surface-hover hover:text-white">{icon}{children}</button>;
}
