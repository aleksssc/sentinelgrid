"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type AcceptInviteResult = {
  success?: boolean;
  organizationId?: string;
  error?: string;
};

export async function acceptOrganizationInvite(
  token: string
): Promise<AcceptInviteResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "Authentication required.",
    };
  }

  if (!token) {
    return {
      error: "Invitation token is missing.",
    };
  }

  const {
    data: organizationId,
    error,
  } = await supabase.rpc(
    "accept_organization_invite",
    {
      p_token: token,
    }
  );

  if (error) {
    console.error(
      "Accept invitation error:",
      error
    );

    return {
      error: error.message,
    };
  }

  if (!organizationId) {
    return {
      error: "Unable to join organization.",
    };
  }

  revalidatePath(
    "/dashboard/organizations"
  );

  revalidatePath(
    `/dashboard/organizations/${organizationId}`
  );

  revalidatePath(
    `/dashboard/organizations/${organizationId}/members`
  );

  return {
    success: true,
    organizationId:
      organizationId as string,
  };
}