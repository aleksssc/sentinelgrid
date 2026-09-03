import {
  readFile,
  stat,
} from "fs/promises";

import path from "path";

import {
  NextRequest,
  NextResponse,
} from "next/server";

export async function GET(
  request: NextRequest
) {
  try {
    /* =========================
       TOKEN
    ========================= */

    const token =
      request.nextUrl.searchParams.get(
        "token"
      );

    if (
      !token ||
      !token.startsWith(
        "SG-ENROLL-"
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
       MSI PATH
    ========================= */

    const filePath =
      path.join(
        process.cwd(),
        "installer",
        "windows",
        "SentinelGridAgent.msi"
      );

    /* =========================
       READ MSI
    ========================= */

    const fileStats =
      await stat(
        filePath
      );

    const file =
      await readFile(
        filePath
      );

    /* =========================
       FILE NAME

       Token is embedded in the
       filename.

       The Agent reads this during
       MSI enrollment.
    ========================= */

    const fileName =
      `SentinelGridAgent__${token}.msi`;

    /* =========================
       RESPONSE
    ========================= */

    return new NextResponse(
      file,
      {
        status: 200,

        headers: {
          "Content-Type":
            "application/x-msi",

          "Content-Disposition":
            `attachment; filename="${fileName}"`,

          "Content-Length":
            fileStats.size.toString(),

          "Cache-Control":
            "no-store",
        },
      }
    );
  } catch (error) {
    console.error(
      "MSI download error:",
      error
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
}