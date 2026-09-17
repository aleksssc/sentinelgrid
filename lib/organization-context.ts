import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const getOrganizationContext = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, organization: null, ownedOrganization: null, organizations: [] };
  const { data, error } = await supabase.from("organizations").select("id, name, owner_id, setup_completed").order("name");
  if (error) throw new Error("Organization context lookup failed", { cause: error });
  const { data: memberships, error: membershipError } = await supabase.from("organization_members").select("organization_id").eq("user_id", user.id);
  if (membershipError) throw new Error("Membership lookup failed", { cause: membershipError });
  const memberIds = new Set((memberships ?? []).map((m) => m.organization_id));
  const organizations = (data ?? []).filter((o) => o.owner_id === user.id || memberIds.has(o.id));
  const selectedId = (await cookies()).get("sentinelgrid-organization")?.value;
  const available = organizations.filter((o) => o.setup_completed);
  const organization = available.find((o) => o.id === selectedId) ?? (available.length === 1 ? available[0] : null);
  const owned = organizations.filter((o) => o.owner_id === user.id);
  const ownedOrganization = owned.find((o) => o.id === selectedId) ?? (owned.length === 1 ? owned[0] : null);
  return { user, organization, ownedOrganization, organizations };
});
