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
      request.nextUrl.origin
    );

  const installerResponse =
    await fetch(
      installerUrl,
      {
        cache: "no-store",
      }
    );

  if (!installerResponse.ok) {
    console.error(
      "MSI fetch failed:",
      installerResponse.status,
      installerUrl.toString()
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
     READ MSI
  ========================= */

  const buffer =
    await installerResponse.arrayBuffer();

  const bytes =
    new Uint8Array(
      buffer
    );

  /*
    MSI files use the Microsoft
    Compound File signature:

    D0 CF 11 E0 A1 B1 1A E1
  */

  const validMsi =
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1;

  if (!validMsi) {
    console.error(
      "Downloaded source is not a valid MSI.",
      {
        size: bytes.length,
        firstBytes:
          Array.from(
            bytes.slice(0, 8)
          ),
      }
    );

    return NextResponse.json(
      {
        error:
          "Invalid installer file.",
      },
      {
        status: 500,
      }
    );
  }

  /* =========================
     DOWNLOAD NAME
  ========================= */

  const fileName =
    `SentinelGridAgent__${token}.msi`;

  return new Response(
    buffer,
    {
      status: 200,

      headers: {
        "Content-Type":
          "application/x-msi",

        "Content-Disposition":
          `attachment; filename="${fileName}"`,

        "Cache-Control":
          "private, no-store, max-age=0",

        "X-Content-Type-Options":
          "nosniff",
      },
    }
  );
}