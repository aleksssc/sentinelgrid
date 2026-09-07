import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";

type AuditStatus =
  | "success"
  | "failed";

type CreateAuditLogParams = {
  organizationId: string;

  action: string;

  targetType?: string;
  targetId?: string;
  targetName?: string;

  status?: AuditStatus;

  metadata?: Record<
    string,
    unknown
  >;
};

export async function createAuditLog({
  organizationId,
  action,
  targetType,
  targetId,
  targetName,
  status = "success",
  metadata = {},
}: CreateAuditLogParams) {
  try {
    const supabase =
      await createClient();

    const {
      data: { user },
    } =
      await supabase.auth.getUser();

    if (!user) {
      console.error(
        "[Audit] No authenticated user",
      );

      return;
    }

    const requestHeaders =
      await headers();

    const forwardedFor =
      requestHeaders.get(
        "x-forwarded-for",
      );

    const realIp =
      requestHeaders.get(
        "x-real-ip",
      );

    const ipAddress =
      forwardedFor
        ?.split(",")[0]
        ?.trim() ||
      realIp ||
      null;

    const {
      error,
    } =
      await supabase
        .from("audit_logs")
        .insert({
          organization_id:
            organizationId,

          user_id:
            user.id,

          actor_email:
            user.email ?? null,

          action,

          target_type:
            targetType ?? null,

          target_id:
            targetId ?? null,

          target_name:
            targetName ?? null,

          status,

          ip_address:
            ipAddress,

          metadata,
        });

    if (error) {
      console.error(
        "[Audit] Failed to create log:",
        error,
      );
    }
  } catch (error) {
    console.error(
      "[Audit] Unexpected error:",
      error,
    );
  }
}