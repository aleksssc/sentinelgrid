export const DEVICE_ACTIONS = [
  { type: "force_inventory", label: "Force Inventory", group: "Maintenance", icon: "inventory", completed: "Force inventory completed" },
  { type: "flush_dns", label: "Flush DNS", group: "Maintenance", icon: "network", completed: "DNS cache flushed" },
  { type: "gpupdate", label: "GPUpdate", group: "Maintenance", icon: "policy", completed: "Group Policy updated" },
  { type: "restart_agent", label: "Restart Agent", group: "Agent", icon: "restart", completed: "Agent restarted" },
  { type: "update_agent", label: "Update Agent", group: "Agent", icon: "update", completed: "Agent updated" },
  { type: "lock", label: "Lock Computer", group: "Power", icon: "lock", completed: "Computer locked" },
  { type: "reboot", label: "Restart Computer", group: "Power", icon: "restart", completed: "Computer restarted" },
  { type: "shutdown", label: "Shutdown Computer", group: "Power", icon: "power", completed: "Computer shut down" },
] as const;
export type QuickAction = typeof DEVICE_ACTIONS[number]["type"];
export const ACTIVE_COMMAND_STATUSES = ["queued", "dispatched", "acknowledged", "running"];
export type ActionAvailability = Record<QuickAction, string | null>;
export function actionLabel(type: string) {
  return DEVICE_ACTIONS.find((action) => action.type === type)?.label ?? "Device command";
}
export function commandLifetime(type: QuickAction, delay = 0) {
  if (type === "update_agent") return 5 * 60_000;
  const minutes = type === "reboot" ? 30 : type === "gpupdate" ? 15 : 5;
  return minutes * 60_000 + delay * 1000;
}
