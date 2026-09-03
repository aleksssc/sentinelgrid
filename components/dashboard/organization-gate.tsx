import type {
  ReactNode,
} from "react";

import {
  redirect,
} from "next/navigation";

import {
  getOrganizationContext,
} from "@/lib/organization-context";

export default async function OrganizationGate({
  children,
}: {
  children: ReactNode;
}) {
  const {
    user,
    organization,
  } =
    await getOrganizationContext();

  if (!user) {
    redirect(
      "/auth/login"
    );
  }

  if (!organization) {
    redirect(
      "/onboarding"
    );
  }

  return children;
}