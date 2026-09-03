import {
  NextRequest,
  NextResponse,
} from "next/server";

export async function GET(
  request: NextRequest
) {
  const token =
    request.nextUrl.searchParams.get(
      "token"
    );

  if (
    !token ||
    !token.startsWith("SG-ENROLL-")
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

  const installerUrl =
    new URL(
      "/downloads/SentinelGridAgent.msi",
      request.url
    );

  return NextResponse.redirect(
    installerUrl
  );
}