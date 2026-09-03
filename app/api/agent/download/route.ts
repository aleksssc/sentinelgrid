import {
  connection,
  NextRequest,
  NextResponse,
} from "next/server";

export async function GET(
  request: NextRequest
) {
  await connection();

  /* =========================
     TOKEN
  ========================= */

  const token =
    request.nextUrl.searchParams
      .get("token")
      ?.trim();

  if (
    !token ||
    !/^SG-ENROLL-[A-Za-z0-9_-]+$/.test(
      token
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid enrollment token.",
      },
      {
        status: 400,
      }
    );
  }

  /* =========================
     UNIVERSAL MSI
  ========================= */

  const installerUrl =
    new URL(
      "/downloads/SentinelGridAgent.msi",
      request.url
    );

  const installerResponse =
    await fetch(
      installerUrl,
      {
        cache: "no-store",
      }
    );

  if (
    !installerResponse.ok ||
    !installerResponse.body
  ) {
    console.error(
      "Could not load universal MSI:",
      installerResponse.status
    );

    return NextResponse.json(
      {
        error:
          "Installer not found.",
      },
      {
        status: 404,
      }
    );
  }

  /* =========================
     DYNAMIC DOWNLOAD NAME
  ========================= */

  const fileName =
    `SentinelGridAgent__${token}.msi`;

  const headers =
    new Headers();

  headers.set(
    "Content-Type",
    installerResponse.headers.get(
      "content-type"
    ) ||
      "application/octet-stream"
  );

  headers.set(
    "Content-Disposition",
    `attachment; filename="${fileName}"`
  );

  headers.set(
    "Cache-Control",
    "no-store, private"
  );

  const contentLength =
    installerResponse.headers.get(
      "content-length"
    );

  if (contentLength) {
    headers.set(
      "Content-Length",
      contentLength
    );
  }

  return new Response(
    installerResponse.body,
    {
      status: 200,
      headers,
    }
  );
}