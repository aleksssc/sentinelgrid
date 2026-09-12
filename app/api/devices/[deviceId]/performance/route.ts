import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readPerformanceHistory } from "@/lib/performance/history";
import { isPerformanceRange } from "@/lib/performance/metrics";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  try {
    const { deviceId } = await params;
    const range = new URL(request.url).searchParams.get("range") ?? "1h";
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(deviceId) || !isPerformanceRange(range)) {
      return NextResponse.json({ error: "Invalid device or performance range." }, { status: 400, headers });
    }
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Sign in to view performance." }, { status: 401, headers });
    // Authorize every read through the cookie-authenticated client and existing device RLS.
    const { data: device, error } = await supabase.from("devices").select("id").eq("id", deviceId).maybeSingle();
    if (error) throw new Error("PERFORMANCE_DEVICE_LOOKUP_FAILED");
    if (!device) return NextResponse.json({ error: "Device not found or access denied." }, { status: 404, headers });
    return NextResponse.json(await readPerformanceHistory(device.id, range), { headers });
  } catch {
    console.error("[Performance] HISTORY_READ_FAILED");
    return NextResponse.json({ error: "Performance history is unavailable. Please retry." }, { status: 503, headers });
  }
}
