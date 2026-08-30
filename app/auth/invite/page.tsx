import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import InviteSetupForm from "./invite-setup-form";

export default async function InvitePage() {
  const supabase =
    await createClient();

  /* =========================
     USER
  ========================= */

  const {
    data: { user },
  } =
    await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/auth/login"
    );
  }


  /* =========================
     INVITE METADATA
  ========================= */

  const token =
    user.user_metadata
      ?.organization_invite_token;

  const organizationName =
    user.user_metadata
      ?.organization_name ??
    "Organization";


  if (!token) {
    redirect(
      "/dashboard"
    );
  }


  /* =========================
     INVITATION
  ========================= */

  const {
    data: invitation,
    error: invitationError,
  } = await supabase
    .from(
      "organization_invites"
    )
    .select(`
      id,
      token,
      email,
      status,
      expires_at
    `)
    .eq(
      "token",
      token
    )
    .maybeSingle();


  if (
    invitationError ||
    !invitation
  ) {
    console.error(
      "Invitation lookup error:",
      invitationError
    );

    redirect(
      "/auth/error?error=Invitation not found"
    );
  }


  /* =========================
     STATUS
  ========================= */

  if (
    invitation.status !==
    "pending"
  ) {
    redirect(
      "/dashboard"
    );
  }


  /* =========================
     EXPIRATION
  ========================= */

  if (
    invitation.expires_at &&
    new Date(
      invitation.expires_at
    ) <= new Date()
  ) {
    redirect(
      "/auth/error?error=Invitation expired"
    );
  }


  /* =========================
     EMAIL SECURITY CHECK
  ========================= */

  if (
    !user.email ||
    user.email.toLowerCase() !==
      invitation.email.toLowerCase()
  ) {
    redirect(
      "/auth/error?error=This invitation belongs to another account"
    );
  }


  /* =========================
     UI
  ========================= */

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#05070a] px-6 py-12">

      <InviteSetupForm
        token={
          invitation.token
        }
        email={
          user.email
        }
        organizationName={
          organizationName
        }
      />

    </main>
  );
}