import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { compareVersions } from "@/lib/agent/update-policy";

// Call only after commandContext and the organization/device-scoped command lookup.
export async function updateCommandFeedback(admin: SupabaseClient, device: { id: string; agent_version: string | null }, command: Record<string, unknown>): Promise<{ feedback_code?: string }> {
  if (command.device_id !== device.id || command.command_type !== "update_agent" || command.status !== "failed" ||
      command.error_code !== "UPDATE_FAILED" || command.error_message !== "no newer permitted, unfailed Agent release") return {};
  const started = typeof command.started_at === "string" ? Date.parse(command.started_at) : NaN;
  const completed = typeof command.completed_at === "string" ? Date.parse(command.completed_at) : NaN;
  if (!device.agent_version || !Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return {};
  try {
    const { data: state, error } = await admin.from("device_agent_update_state")
      .select("latest_version, last_check_at").eq("device_id", device.id)
      .abortSignal(AbortSignal.timeout(2000)).maybeSingle();
    if (error) {
      console.error("[Device actions] UPDATE_FEEDBACK_LOOKUP_FAILED", error.code);
      return {};
    }
    const checked = state?.last_check_at ? Date.parse(state.last_check_at) : NaN;
    if (!state?.latest_version || !Number.isFinite(checked) || checked < started || checked > completed) return {};
    if (compareVersions(state.latest_version, device.agent_version) <= 0) return { feedback_code: "NO_NEWER_AGENT_VERSION" };
    return {};
  } catch (error) {
    console.error("[Device actions] UPDATE_FEEDBACK_UNAVAILABLE", error instanceof Error ? error.name : "UnknownError");
    return {};
  }
}
