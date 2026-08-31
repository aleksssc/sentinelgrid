import { NextResponse } from "next/server";

import { createEnrollmentToken } from "@/lib/agent/enrollment";

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const organizationId =
      body.organizationId as
        | string
        | undefined;

    const clientId =
      body.clientId as
        | string
        | undefined;

    const siteId =
      body.siteId as
        | string
        | null
        | undefined;

    if (
      !organizationId ||
      !clientId
    ) {
      return NextResponse.json(
        {
          error:
            "Organization and client are required.",
        },
        {
          status: 400,
        }
      );
    }

    const result =
      await createEnrollmentToken({
        organizationId,
        clientId,
        siteId,
      });

    return NextResponse.json(
      result
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "";

    switch (message) {
      case "UNAUTHORIZED":
        return NextResponse.json(
          {
            error: "Unauthorized",
          },
          {
            status: 401,
          }
        );

      case "FORBIDDEN":
        return NextResponse.json(
          {
            error:
              "You do not have permission to enroll devices.",
          },
          {
            status: 403,
          }
        );

      case "ORGANIZATION_NOT_FOUND":
        return NextResponse.json(
          {
            error:
              "Organization not found.",
          },
          {
            status: 404,
          }
        );

      case "CLIENT_NOT_FOUND":
        return NextResponse.json(
          {
            error:
              "Client not found.",
          },
          {
            status: 404,
          }
        );

      case "SITE_NOT_FOUND":
        return NextResponse.json(
          {
            error:
              "Site not found.",
          },
          {
            status: 404,
          }
        );

      default:
        console.error(
          "Enrollment API error:",
          error
        );

        return NextResponse.json(
          {
            error:
              "Could not generate enrollment token.",
          },
          {
            status: 500,
          }
        );
    }
  }
}