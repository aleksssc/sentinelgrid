export type UpdateChannel = "dev" | "beta" | "stable";

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const NUMERIC = /^[0-9]+$/;

export function parseVersion(value: unknown): RegExpMatchArray {
  if (typeof value !== "string" || value.length > 128) throw new Error("INVALID_VERSION");
  const parts = value.match(SEMVER);
  if (!parts || parts[4]?.split(".").some((id) => NUMERIC.test(id) && id.length > 1 && id[0] === "0")) {
    throw new Error("INVALID_VERSION");
  }
  return parts;
}

function compareNumber(a: string, b: string): number {
  return a.length === b.length ? (a === b ? 0 : a < b ? -1 : 1) : a.length < b.length ? -1 : 1;
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 1; i <= 3; i++) {
    const result = compareNumber(x[i], y[i]);
    if (result) return result;
  }
  if (x[4] === y[4]) return 0;
  if (!x[4]) return 1;
  if (!y[4]) return -1;
  const xp = x[4].split("."), yp = y[4].split(".");
  for (let i = 0; i < Math.min(xp.length, yp.length); i++) {
    const xn = NUMERIC.test(xp[i]), yn = NUMERIC.test(yp[i]);
    const result = xn && yn ? compareNumber(xp[i], yp[i])
      : xn !== yn ? (xn ? -1 : 1) : xp[i] === yp[i] ? 0 : xp[i] < yp[i] ? -1 : 1;
    if (result) return result;
  }
  return xp.length < yp.length ? -1 : 1;
}

export function effectiveChannel(organization: unknown, deviceOverride?: unknown): UpdateChannel {
  const channel = deviceOverride ?? organization;
  if (channel !== "dev" && channel !== "beta" && channel !== "stable") throw new Error("INVALID_CHANNEL");
  return channel;
}

export type AgentRelease = {
  id: string;
  version: string;
  channel: UpdateChannel;
  platform: string;
  architecture: string;
  storage_path: string;
  sha256: string;
  size_bytes: number;
  published_at: string;
};

export function selectRelease(releases: AgentRelease[], current: string, channel: UpdateChannel): AgentRelease | undefined {
  parseVersion(current);
  let latest: AgentRelease | undefined;
  for (const release of releases) {
    const version = parseVersion(release.version);
    if (release.channel !== channel || release.platform !== "windows" || release.architecture !== "amd64") continue;
    if (channel === "stable" && version[4]) throw new Error("INVALID_STABLE_RELEASE");
    if (!/^[a-fA-F0-9]{64}$/.test(release.sha256) || !Number.isSafeInteger(release.size_bytes) || release.size_bytes <= 0 || release.size_bytes > 268435456) {
      throw new Error("INVALID_RELEASE_ARTIFACT");
    }
    if (release.storage_path !== `${channel}/${release.version}/SentinelGridAgent.exe`) throw new Error("INVALID_RELEASE_PATH");
    if (compareVersions(release.version, current) > 0 && (!latest || compareVersions(release.version, latest.version) > 0)) latest = release;
  }
  return latest;
}
