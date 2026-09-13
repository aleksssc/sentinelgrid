import "server-only";

import { createHash } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";

export class UpdateAPIError extends Error {
  constructor(
    public code: string,
    public status: number
  ) {
    super(code);
  }
}

export async function authenticateUpdateAgent(
  request: Request
) {
  const header =
    request.headers.get("authorization") ?? "";

  const token =
    /^Bearer\s+(\S+)$/i.exec(header)?.[1];

  if (
    !token ||
    token.length > 512
  ) {
    throw new UpdateAPIError(
      "INVALID_AGENT",
      401
    );
  }

  const admin =
    createAdminClient();

  /* =========================================================
     DEVICE LOOKUP
  ========================================================= */

  const {
    data: device,
    error: deviceError,
  } = await admin
    .from("devices")
    .select(`
      id,
      client_id,
      agent_version,
      capabilities
    `)
    .eq(
      "agent_token_hash",
      createHash("sha256")
        .update(token)
        .digest("hex")
    )
    .maybeSingle();

  if (deviceError) {
    console.error(
      "[Agent update device lookup]",
      {
        code:
          deviceError.code,

        message:
          deviceError.message,

        details:
          deviceError.details,

        hint:
          deviceError.hint,
      }
    );

    throw new UpdateAPIError(
      "AGENT_LOOKUP_FAILED",
      503
    );
  }

  if (!device) {
    throw new UpdateAPIError(
      "INVALID_AGENT",
      401
    );
  }

  /* =========================================================
     ORGANIZATION LOOKUP
  ========================================================= */

  const {
    data: client,
    error: clientError,
  } = await admin
    .from("clients")
    .select("organization_id")
    .eq(
      "id",
      device.client_id
    )
    .single();

  if (clientError) {
    console.error(
      "[Agent update organization lookup]",
      {
        code:
          clientError.code,

        message:
          clientError.message,

        details:
          clientError.details,

        hint:
          clientError.hint,
      }
    );

    throw new UpdateAPIError(
      "ORGANIZATION_LOOKUP_FAILED",
      503
    );
  }

  if (
    !client ||
    typeof client.organization_id !==
      "string"
  ) {
    console.error(
      "[Agent update organization lookup]",
      "CLIENT_WITHOUT_ORGANIZATION"
    );

    throw new UpdateAPIError(
      "ORGANIZATION_LOOKUP_FAILED",
      503
    );
  }

  return {
    admin,
    device,
    organizationId:
      client.organization_id,
  };
}

export function updateErrorResponse(
  error: unknown
): Response {
  const expected =
    error instanceof UpdateAPIError;

  const code =
    expected
      ? error.code
      : "UPDATE_SERVICE_FAILED";

  const status =
    expected
      ? error.status
      : 503;

  /*
   * Never log:
   * - request objects
   * - bearer tokens
   * - signed URLs
   * - storage responses
   */

  console.error(
    "[Agent update]",
    code
  );

  return Response.json(
    {
      error: code,
    },
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",
      },
    }
  );
}