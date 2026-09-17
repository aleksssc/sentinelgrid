"use server";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ResourceCreationError, requireOrganizationResourceCreation } from "@/lib/resource-creation";

export type CreateClientState = {
  error?: string;
};

export async function createClientAction(
  organizationId: string,
  _previousState: CreateClientState,
  formData: FormData
): Promise<CreateClientState> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) return { error: "Client name is required." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You must be logged in." };

  try {
    await requireOrganizationResourceCreation(createAdminClient(), organizationId, user.id, "clients");
  } catch (error) {
    if (error instanceof ResourceCreationError) {
      if (error.code === "LIMIT_REACHED") return { error: "Client limit reached. Upgrade to Pro to create more clients." };
      if (error.code === "SUBSCRIPTION_RESTRICTED") return { error: "Your subscription requires attention before new clients can be created." };
      return { error: "You don't have permission to create clients." };
    }
    console.error("Client creation access check failed:", error);
    return { error: "Could not verify whether a client can be created." };
  }

  const { data, error } = await createAdminClient()
    .from("clients")
    .insert({ organization_id: organizationId, name, description: description || null, created_by: user.id })
    .select("id")
    .single();

  if (error || !data) {
    console.error("Client creation error:", error);
    return {
      error: error?.message?.includes("LIMIT_REACHED") ? "Client limit reached. Upgrade your plan to add more clients." : error?.code === "23505"
        ? "A client with this name already exists in this organization."
        : "Could not create client.",
    };
  }

  redirect(`/dashboard/organizations/${organizationId}/clients/${data.id}`);
}
