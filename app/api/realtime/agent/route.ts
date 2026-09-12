import { experimental_upgradeWebSocket } from "@vercel/functions";
import { connection } from "next/server";
import { attachAgentSocket } from "@/lib/realtime/agent-socket";

export async function GET() {
  await connection();
  return experimental_upgradeWebSocket(attachAgentSocket, { maxPayload: 4 * 1024 * 1024 });
}
