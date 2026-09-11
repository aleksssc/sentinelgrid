import { parseVersion } from "./update-policy";

const STATES = new Set(["checking", "available", "downloading", "verifying", "staged", "installing", "restarting", "succeeded", "failed", "rolled_back"]);
const ERRORS = new Set(["CHECK_FAILED", "DOWNLOAD_FAILED", "VERIFICATION_FAILED", "BACKUP_FAILED", "INSTALL_OR_HEALTH_FAILED", "ROLLBACK_FAILED", "UPDATER_NOT_OPERATIONAL"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type UpdateReport = {
  update_status: string;
  update_target_version?: string;
  update_error?: string;
  transaction_id?: string;
  command_id?: string;
};

export function parseUpdateReport(value: unknown): UpdateReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_UPDATE_REPORT");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["update_status", "update_target_version", "update_error", "transaction_id", "command_id"].includes(key)) ||
    typeof input.update_status !== "string" || !STATES.has(input.update_status)) throw new Error("INVALID_UPDATE_REPORT");
  if (input.update_target_version !== undefined) parseVersion(input.update_target_version);
  if (input.update_error !== undefined && (typeof input.update_error !== "string" || !ERRORS.has(input.update_error))) throw new Error("INVALID_UPDATE_ERROR");
  for (const field of ["transaction_id", "command_id"]) {
    if (input[field] !== undefined && (typeof input[field] !== "string" || !UUID.test(input[field]))) throw new Error("INVALID_UPDATE_CORRELATION");
  }
  if ((input.command_id !== undefined && input.transaction_id === undefined) ||
    (input.transaction_id !== undefined && input.update_target_version === undefined)) throw new Error("INVALID_UPDATE_CORRELATION");
  return {
    update_status: input.update_status,
    update_target_version: typeof input.update_target_version === "string" ? input.update_target_version : undefined,
    update_error: typeof input.update_error === "string" ? input.update_error : undefined,
    transaction_id: typeof input.transaction_id === "string" ? input.transaction_id : undefined,
    command_id: typeof input.command_id === "string" ? input.command_id : undefined,
  };
}
