import {
  getBillingManagementSummary,
} from "@/lib/billing/management";

export const runtime =
  "nodejs";

function validOrganizationId(
  value: string | null
) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
      )
  );
}

export async function GET(
  request: Request
) {
  try {
    const url =
      new URL(
        request.url
      );

    const organizationId =
      url.searchParams.get(
        "organizationId"
      );

    if (
      !validOrganizationId(
        organizationId
      )
    ) {
      return Response.json(
        {
          error:
            "Invalid organization.",
        },
        {
          status:
            400,
        }
      );
    }

    const summary =
      await getBillingManagementSummary(
        organizationId!
      );

    return Response.json(
      summary,
      {
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "Organization permission denied"
    ) {
      return Response.json(
        {
          error:
            "Only the organization owner can manage billing.",
        },
        {
          status:
            403,
        }
      );
    }

    console.error(
      "Billing summary failed",
      error
    );

    return Response.json(
      {
        error:
          "Billing information could not be loaded.",
      },
      {
        status:
          500,
      }
    );
  }
}