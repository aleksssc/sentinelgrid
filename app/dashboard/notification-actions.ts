"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";


export type NotificationActionResult = {
  success?: boolean;
  error?: string;
  organizationId?: string;
};


export async function acceptInvitationNotification(
  token: string
): Promise<NotificationActionResult> {
  const supabase =
    await createClient();


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
      "Accept notification error:",
      error
    );

    return {
      error: error.message,
    };
  }


  revalidatePath(
    "/dashboard",
    "layout"
  );

  revalidatePath(
    "/dashboard/organizations"
  );


  return {
    success: true,
    organizationId:
      organizationId as string,
  };
}



export async function declineInvitationNotification(
  token: string
): Promise<NotificationActionResult> {
  const supabase =
    await createClient();


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
    "decline_organization_invite",
    {
      p_token: token,
    }
  );


  if (error) {
    console.error(
      "Decline notification error:",
      error
    );

    return {
      error: error.message,
    };
  }


  revalidatePath(
    "/dashboard",
    "layout"
  );


  return {
    success: true,
    organizationId:
      organizationId as string,
  };
}