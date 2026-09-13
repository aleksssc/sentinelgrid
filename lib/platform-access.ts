import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const platformRoles = ["platform_admin", "developer"] as const;
export type PlatformRole = (typeof platformRoles)[number];
export type PlatformActor = { id: string; email: string | null; role: PlatformRole };

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && platformRoles.includes(value as PlatformRole);
}

export async function getPlatformRole(): Promise<PlatformRole | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return isPlatformRole(user?.app_metadata.platform_role) ? user.app_metadata.platform_role : null;
}

export async function requirePlatformAdmin(): Promise<PlatformRole> {
  const role = await getPlatformRole();
  if (!role) redirect("/dashboard");
  return role;
}

export async function requirePlatformActor(): Promise<PlatformActor> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata.platform_role;
  if (!user || !isPlatformRole(role)) redirect("/dashboard");
  return { id: user.id, email: user.email ?? null, role };
}
