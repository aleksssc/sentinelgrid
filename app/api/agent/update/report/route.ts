import { authenticateUpdateAgent, UpdateAPIError, updateErrorResponse } from "@/lib/agent/update-auth";
import { parseUpdateReport } from "@/lib/agent/update-report";

async function readReport(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new UpdateAPIError("INVALID_UPDATE_REPORT", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        throw new UpdateAPIError("INVALID_UPDATE_REPORT", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new UpdateAPIError("INVALID_UPDATE_REPORT", 400); }
}

export async function POST(request: Request) {
  try {
    const { admin, device } = await authenticateUpdateAgent(request);
    const body = await readReport(request);
    let input;
    try { input = parseUpdateReport(body); }
    catch { throw new UpdateAPIError("INVALID_UPDATE_REPORT", 400); }
    const args = {
      p_device_id: device.id, p_status: input.update_status,
      p_target: input.update_target_version ?? null, p_error: input.update_error ?? null,
    };
    const { data: accepted, error } = input.transaction_id
      ? await admin.rpc("report_agent_update_transaction", {
        ...args, p_transaction_id: input.transaction_id, p_command_id: input.command_id ?? null,
      })
      : await admin.rpc("report_agent_update", args);
    if (error) throw new UpdateAPIError("UPDATE_REPORT_FAILED", 503);
    if (!accepted) throw new UpdateAPIError("RATE_LIMITED", 429);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return updateErrorResponse(error);
  }
}
