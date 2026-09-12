import { experimental_upgradeWebSocket } from "@vercel/functions";
import { connection } from "next/server";
import { attachBrowserSocket } from "@/lib/realtime/browser-socket";

export async function GET() {
  await connection();
  return experimental_upgradeWebSocket(attachBrowserSocket, { maxPayload: 4 * 1024 * 1024 });
}
