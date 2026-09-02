import {
  NextRequest,
  NextResponse,
  connection,
} from "next/server";

import path from "node:path";

import {
  readFile,
  stat,
} from "node:fs/promises";

export async function GET(
  request: NextRequest
) {
  await connection();

  try {
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

    const filePath =
      path.join(
        process.cwd(),
        "installer",
        "windows",
        "SentinelGridAgent.msi"
      );

    const fileStats =
      await stat(
        filePath
      );

    const file =
      await readFile(
        filePath
      );

    /*
      The enrollment token is placed in the
      downloaded MSI filename.

      The Agent will read the MSI filename
      during installation and extract it.
    */

    const fileName =
      `SentinelGridAgent__${token}.msi`;

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