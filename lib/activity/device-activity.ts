export type DeviceActivity = {
  id: string;
  action: string;
  status: string | null;
  target_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  actor_email?: string | null;
  user_id?: string | null;
};

export type DeviceActivityCommand = {
  id: string;
  device_id: string;
  command_type: string;
  status: string;
  created_at: string;
  requested_by?: string | null;
  dispatched_at?: string | null;
  acknowledged_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  result?: unknown;
  payload?: unknown;
  error_code?: string | null;
  error_message?: string | null;
  update_transaction_id?: string | null;
  update_transaction?: DeviceActivityUpdateTransaction;
};

export type DeviceActivityUpdateTransaction = {
  id: string;
  device_id: string;
  target_version?: string | null;
  previous_version?: string | null;
  metadata?: unknown;
  journal?: unknown;
  update_journal?: unknown;
};

export type ActivityStatus = "succeeded" | "failed" | "running" | "requested" | "queued" | "warning" | "info";
export type ActivityCategory = "commands" | "updates" | "remote" | "system";
export type ActivityFilter = "all" | ActivityCategory | "failed";
export type ActivityIcon = "update" | "restart" | "shutdown" | "lock" | "terminal" | "inventory" | "network" | "remote" | "system";
export type ActivityEntry = {
  id: string;
  title: string;
  summary: string;
  category: ActivityCategory;
  icon: ActivityIcon;
  status: ActivityStatus;
  phase: string;
  commandType?: string;
  commandId?: string;
  transactionId?: string;
  requestedBy?: string;
  requestedAt?: string;
  startedAt?: string;
  completedAt?: string;
  timestamp: string;
  duration?: string;
  fromVersion?: string;
  targetVersion?: string;
  errorCode?: string;
  errorMessage?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  events: DeviceActivity[];
};

type Data = Record<string, unknown>;
function record(value: unknown): Data {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
}
function sources(value: unknown): Data[] {
  const root = record(value);
  const metadata = record(root.metadata);
  const result = record(root.result);
  return [root, metadata, result, record(root.payload), record(root.update), record(root.transaction),
    record(metadata.result), record(metadata.update), record(metadata.transaction), record(result.update), record(result.transaction)];
}
function versionSources(value: unknown): Data[] {
  const data = sources(value);
  return [...data, ...data.flatMap((source) => [record(source.journal), record(source.update_journal)])];
}
function text(data: Data[], ...keys: string[]): string | undefined {
  for (const source of data) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}
function time(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function validDate(value: string | undefined): string | undefined {
  return time(value) === undefined ? undefined : value;
}

export function activityCorrelation(value: unknown) {
  const data = sources(value);
  return {
    commandId: text(data, "commandId", "command_id"),
    transactionId: text(data, "transactionId", "transaction_id", "update_transaction_id", "updateTransactionId"),
  };
}

const FROM_VERSION_KEYS = ["from_version", "fromVersion", "previous_version", "previousVersion", "source_version", "sourceVersion", "old_version", "current_version"];
const TARGET_VERSION_KEYS = ["target_version", "targetVersion", "update_target_version", "updateTargetVersion", "to_version", "toVersion", "new_version"];

export function enrichActivityUpdateCommands(
  commands: DeviceActivityCommand[], transactions: DeviceActivityUpdateTransaction[],
): DeviceActivityCommand[] {
  const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  return commands.map((command) => {
    const transaction = command.update_transaction_id ? byId.get(command.update_transaction_id) : undefined;
    if (command.command_type !== "update_agent" || !transaction || transaction.device_id !== command.device_id) return command;
    const data = versionSources(transaction);
    return {
      ...command,
      update_transaction: {
        id: transaction.id, device_id: transaction.device_id,
        target_version: text(data, ...TARGET_VERSION_KEYS),
        previous_version: text(data, ...FROM_VERSION_KEYS),
      },
    };
  });
}

const ACTIONS: Record<string, { label: string; icon: ActivityIcon }> = {
  update_agent: { label: "Update Agent", icon: "update" },
  restart_agent: { label: "Restart Agent", icon: "restart" },
  reboot: { label: "Restart Computer", icon: "restart" },
  restart: { label: "Restart Computer", icon: "restart" },
  shutdown: { label: "Shutdown Computer", icon: "shutdown" },
  lock: { label: "Lock Computer", icon: "lock" },
  flush_dns: { label: "Flush DNS", icon: "network" },
  gpupdate: { label: "GPUpdate", icon: "system" },
  force_inventory: { label: "Force Inventory", icon: "inventory" },
  terminal: { label: "Terminal session", icon: "terminal" },
};
export function humanizeActivity(value: string): string {
  const words = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Device activity";
}
export function formatActivityDuration(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds % 60}s`;
}
function statusOf(phase: string): ActivityStatus {
  if (["succeeded", "success", "completed", "closed"].includes(phase)) return "succeeded";
  if (["failed", "error", "expired", "rolled_back", "denied", "rejected"].includes(phase)) return "failed";
  if (["running", "active", "started", "checking", "available", "downloading", "verifying", "staged", "installing", "restarting"].includes(phase)) return "running";
  if (phase === "requested") return "requested";
  if (["queued", "dispatched", "acknowledged", "pending"].includes(phase)) return "queued";
  if (["warning", "cancelled", "canceled", "revoked"].includes(phase)) return "warning";
  return "info";
}
function terminal(status: ActivityStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "warning";
}
type Snapshot = {
  key: string;
  deviceId: string;
  data: Data[];
  versionData?: Data[];
  transactionData?: Data[];
  payloadData?: Data[];
  action: string;
  phase: string;
  status: ActivityStatus;
  timestamp: string;
  commandId?: string;
  transactionId?: string;
  commandType?: string;
  requestedAt?: string;
  startedAt?: string;
  completedAt?: string;
  actor?: string;
  actorEmail?: string;
  event?: DeviceActivity;
};

export function normalizeDeviceActivity(
  events: DeviceActivity[], commands: DeviceActivityCommand[], deviceId: string,
): ActivityEntry[] {
  const snapshots: Snapshot[] = [];
  for (const event of events) {
    if (event.target_id !== deviceId) continue;
    const data = sources(event.metadata);
    const actionPhase = event.action.split(".").at(-1) ?? "";
    // Audit success means the request was recorded, not that the command completed.
    const phase = text(data, "update_status", "updateStatus") ??
      (statusOf(actionPhase) !== "info" ? actionPhase : text(data, "status") ?? event.status ?? "info");
    const status = statusOf(phase);
    snapshots.push({
      key: `audit:${event.id}`, deviceId, data, action: event.action, phase, status,
      versionData: versionSources(event.metadata),
      timestamp: event.created_at, ...activityCorrelation(event.metadata),
      commandType: text(data, "commandType", "command_type"),
      requestedAt: validDate(text(data, "requested_at", "requestedAt")) ?? (phase === "requested" ? validDate(event.created_at) : undefined),
      startedAt: validDate(text(data, "started_at", "startedAt")),
      completedAt: validDate(text(data, "completed_at", "completedAt")) ?? (terminal(status) ? validDate(event.created_at) : undefined),
      actor: text(data, "requested_by", "requestedBy") ?? event.user_id ?? undefined,
      actorEmail: event.actor_email ?? undefined, event,
    });
  }
  for (const command of commands) {
    if (command.device_id !== deviceId) continue;
    const data = sources(command);
    const transaction = command.update_transaction;
    const linkedTransaction = transaction?.id === command.update_transaction_id && transaction?.device_id === deviceId
      ? transaction : undefined;
    const reportedPhase = text(sources(command.result), "update_status", "updateStatus");
    const phase = terminal(statusOf(command.status)) ? command.status : reportedPhase ?? command.status;
    snapshots.push({
      key: `command:${command.id}`, deviceId, data, action: "device.command", phase, status: statusOf(phase),
      versionData: versionSources({ ...command, payload: undefined }),
      transactionData: versionSources(linkedTransaction), payloadData: versionSources(command.payload),
      timestamp: validDate(command.completed_at ?? undefined) ?? validDate(command.started_at ?? undefined) ??
        validDate(command.acknowledged_at ?? undefined) ?? validDate(command.dispatched_at ?? undefined) ?? command.created_at,
      commandId: command.id, transactionId: activityCorrelation(command).transactionId,
      commandType: command.command_type, requestedAt: validDate(command.created_at),
      startedAt: validDate(command.started_at ?? undefined), completedAt: validDate(command.completed_at ?? undefined),
      actor: command.requested_by ?? undefined,
    });
  }

  // Union both identifiers so transaction-only reports join a command when a bridge arrives.
  const parents = snapshots.map((_, index) => index);
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const identifiers = new Map<string, number>();
  snapshots.forEach((snapshot, index) => {
    const keys = [snapshot.key];
    if (snapshot.commandId) keys.push(`command:${snapshot.commandId}`);
    if (snapshot.transactionId) keys.push(`transaction:${snapshot.transactionId}`);
    for (const key of keys) {
      const scoped = `${snapshot.deviceId}:${key}`;
      const previous = identifiers.get(scoped);
      if (previous !== undefined) parents[find(index)] = find(previous);
      else identifiers.set(scoped, index);
    }
  });
  const groups = new Map<number, Snapshot[]>();
  snapshots.forEach((snapshot, index) => {
    const key = find(index);
    const group = groups.get(key) ?? [];
    group.push(snapshot);
    groups.set(key, group);
  });

  return [...groups.values()].map((group): ActivityEntry => {
    group.sort((a, b) => (time(a.timestamp) ?? 0) - (time(b.timestamp) ?? 0) || a.key.localeCompare(b.key));
    const latest = group[group.length - 1];
    const reversed = [...group].reverse();
    const data = reversed.flatMap((snapshot) => snapshot.data);
    const commandId = reversed.find((snapshot) => snapshot.commandId)?.commandId;
    const transactionId = reversed.find((snapshot) => snapshot.transactionId)?.transactionId;
    const commandType = reversed.find((snapshot) => snapshot.commandType)?.commandType;
    const update = commandType === "update_agent" || group.some((snapshot) => /(?:^|\.)agent[._]update(?:\.|$)/.test(snapshot.action)) || Boolean(transactionId);
    const remote = group.some((snapshot) => snapshot.action.startsWith("remote."));
    const command = Boolean(commandId || commandType) || group.some((snapshot) => snapshot.action.startsWith("device.command"));
    const category: ActivityCategory = update ? "updates" : command ? "commands" : remote ? "remote" : "system";
    const resolved = reversed.find((snapshot) => terminal(snapshot.status)) ??
      reversed.find((snapshot) => snapshot.status === "running") ?? latest;
    const { status, phase } = resolved;
    const action = commandType ? ACTIONS[commandType] : undefined;
    let title = action?.label ?? (commandType ? humanizeActivity(commandType) : command ? "Device command" :
      remote ? (latest.action.includes("terminal") ? "Terminal session" : latest.action.includes("rdp") ? "Remote Desktop session" : "Remote session") : humanizeActivity(latest.action));
    // Recorded audit/result metadata wins over the linked journal, then the requested payload.
    const versionData = update ? [
      ...reversed.filter((snapshot) => snapshot.event).flatMap((snapshot) => snapshot.versionData ?? []),
      ...reversed.filter((snapshot) => !snapshot.event).flatMap((snapshot) => snapshot.versionData ?? []),
      ...reversed.flatMap((snapshot) => snapshot.transactionData ?? []),
      ...reversed.flatMap((snapshot) => snapshot.payloadData ?? []),
    ] : data;
    const fromVersion = text(versionData, ...FROM_VERSION_KEYS);
    const targetVersion = text(versionData, ...TARGET_VERSION_KEYS);
    if (update) title = status === "failed" ? "Agent update failed" : status === "succeeded" && targetVersion ? `Agent updated to ${targetVersion}` : "Update Agent";
    if (!update && status === "succeeded" && commandType) {
      const completed: Record<string, string> = {
        force_inventory: "Force inventory completed", flush_dns: "DNS cache flushed", gpupdate: "Group Policy updated",
        restart_agent: "Agent restarted", lock: "Computer locked", reboot: "Computer restarted", shutdown: "Computer shut down",
      };
      title = completed[commandType] ?? title;
    }
    const requestedAt = group.map((snapshot) => snapshot.requestedAt).filter((value): value is string => Boolean(value)).sort((a, b) => (time(a) ?? 0) - (time(b) ?? 0))[0];
    const startedAt = group.find((snapshot) => snapshot.startedAt)?.startedAt;
    const completedAt = terminal(status) ? resolved.completedAt : undefined;
    const start = time(requestedAt ?? startedAt);
    const end = time(completedAt);
    const durationField = data.flatMap((source) => [
      source.duration_ms, source.durationMs,
      typeof source.duration_seconds === "number" ? source.duration_seconds * 1000 : undefined,
      typeof source.durationSeconds === "number" ? source.durationSeconds * 1000 : undefined,
    ]).find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    const duration = terminal(status) ? (
      start !== undefined && end !== undefined
        ? (end >= start ? formatActivityDuration(end - start) : undefined)
        : durationField !== undefined ? formatActivityDuration(durationField) : undefined
    ) : undefined;
    const errorCode = text(data, "error_code", "errorCode", "update_error", "updateError");
    const errorMessage = text(data, "error_message", "errorMessage");
    let summary = status === "succeeded" ? (duration ? `Succeeded in ${duration}` : "Completed successfully") :
      status === "failed" ? (errorCode ?? (phase === "expired" ? "Command expired" : phase === "rolled_back" ? "Update rolled back" : "Operation failed")) :
      status === "requested" ? "Waiting for the Agent" : status === "queued" ? "Queued for execution" :
      status === "running" ? (phase === "running" ? "In progress" : humanizeActivity(phase)) : humanizeActivity(phase);
    if (update && status === "succeeded" && !targetVersion) summary += " - target version not recorded";
    const uniqueEvents = new Map<string, DeviceActivity>();
    for (const snapshot of group) if (snapshot.event) uniqueEvents.set(snapshot.event.id, snapshot.event);
    return {
      id: `${deviceId}:${commandId ? `command:${commandId}` : transactionId ? `transaction:${transactionId}` : latest.key}`,
      title, summary, category, icon: update ? "update" : action?.icon ?? (remote ? (latest.action.includes("terminal") ? "terminal" : "remote") : "system"),
      status, phase, commandType, commandId, transactionId,
      requestedBy: group.find((snapshot) => snapshot.actorEmail)?.actorEmail ?? group.find((snapshot) => snapshot.actor)?.actor,
      requestedAt, startedAt, completedAt, timestamp: latest.timestamp, duration,
      fromVersion, targetVersion, errorCode, errorMessage,
      stdout: text(data, "stdout")?.slice(0, 4096),
      stderr: text(data, "stderr")?.slice(0, 4096),
      exitCode: data.map((source) => source.exit_code).find((value): value is number => typeof value === "number" && Number.isInteger(value)),
      events: [...uniqueEvents.values()].reverse(),
    };
  }).sort((a, b) => (time(b.timestamp) ?? 0) - (time(a.timestamp) ?? 0) || a.id.localeCompare(b.id));
}

export function filterDeviceActivity(entries: ActivityEntry[], filter: ActivityFilter, query: string): ActivityEntry[] {
  const search = query.trim().toLowerCase();
  return entries.filter((entry) => {
    const matches = filter === "all" || (filter === "failed" ? entry.status === "failed" :
      filter === "commands" ? entry.category === "commands" || Boolean(entry.commandId || entry.commandType) : entry.category === filter);
    return matches && (!search || [entry.title, entry.summary, entry.status, entry.phase, entry.commandType,
      entry.commandId, entry.transactionId, entry.requestedBy, entry.fromVersion, entry.targetVersion,
      entry.errorCode, entry.errorMessage, ...entry.events.map((event) => event.action)].some((value) => value?.toLowerCase().includes(search)));
  });
}

export function activityDay(timestamp: string, now: Date): "Today" | "Yesterday" | "Older" {
  const date = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  return "Older";
}
