import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { publishRelease, validateManifest, validatePublicationProfile, verifyPublishedChannel } from "./publish-agent.mjs";
const hash = (data) => createHash("sha256").update(data).digest("hex");
const signer = "A".repeat(64);
const artifacts = {
  agent: "SentinelGridAgent.exe", updater: "SentinelGridUpdater.exe", rdp_client: "SentinelGridRDP.exe",
  native_video: "SentinelGridVideo.dll", msi: "SentinelGridAgent.msi",
};
function fixture(failure, channel = "beta") {
  const events = [];
  const manifest = { schema_version: 1, server_url: "https://isolated.example", product: "SentinelGridAgent", version: "0.1.6", channel, platform: "windows", architecture: "amd64", signed: true, development_update_build: channel !== "stable", trusted_signer_sha256: [signer], installation_artifact: "msi", update_protocol: 2 };
  const bytes = Buffer.from("isolated test artifact, not an executable");
  for (const [key, filename] of Object.entries(artifacts)) manifest[key] = { filename, version: manifest.version, sha256: hash(bytes), size: bytes.length };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const step = (name) => { events.push(name); if (failure === name) throw new Error(name); };
  let verification = 0;
  return { events, options: { manifest, manifestBytes, version: "0.1.6", channel, signer,
    readArtifact: async () => bytes,
    validateLocal: async () => step("local-signatures"),
    upload: async (path) => { assert.ok(path.startsWith(`${channel}/0.1.6/`)); step(`upload:${path.split("/").at(-1)}`); },
    download: async (path) => { step(`download:${path.split("/").at(-1)}`); return failure === "bad-download" ? Buffer.from("bad") : path.endsWith("manifest.json") ? manifestBytes : bytes; },
    validateStored: async (name) => { if (!name) step("stored-signatures"); },
    activate: async (release) => { assert.equal(release.channel, channel); assert.equal(release.development_build, channel !== "stable"); assert.equal(release.manifest_sha256, hash(manifestBytes)); step("activate"); },
    verifyChannel: async (release) => { assert.equal(release.channel, channel); step(`channel:${++verification}`); },
    verifyWebsite: async () => step("website"),
  } };
}
for (const channel of ["dev", "beta", "stable"]) test(`${channel}: every payload verified before activation and DB checked around website download`, async () => {
  const { options, events } = fixture(undefined, channel); await publishRelease(options);
  assert.equal(events.filter(e => e.startsWith("upload:")).length, 7);
  assert.equal(events.filter(e => e.startsWith("download:")).length, 7);
  for (const filename of Object.values(artifacts)) {
    assert.ok(events.includes(`upload:${filename}`));
    assert.ok(events.includes(`download:${filename}`));
  }
  assert.deepEqual(events.slice(-5), ["stored-signatures", "activate", "channel:1", "website", "channel:2"]);
});
for (const failure of ["local-signatures", "upload:SentinelGridAgent.exe", "upload:SentinelGridUpdater.exe", "upload:SentinelGridRDP.exe", "upload:SentinelGridVideo.dll", "upload:SentinelGridAgent.msi", "download:SentinelGridVideo.dll", "download:SentinelGridAgent.msi", "upload:manifest.json", "stored-signatures", "bad-download"]) {
  test(`publication cannot activate on ${failure}`, async () => {
    const { options, events } = fixture(failure); await assert.rejects(publishRelease(options));
    assert.ok(!events.includes("activate")); assert.ok(!events.includes("website"));
  });
}
for (const failure of ["activate", "channel:1", "website", "channel:2"]) test(`${failure} failure after upload cannot report success`, async () => {
  const { options, events } = fixture(failure);
  await assert.rejects(publishRelease(options), new RegExp(failure));
  assert.equal(events.at(-1), failure);
});
test("local tampering cannot activate or upload", async () => {
  const { options, events } = fixture(); options.readArtifact = async () => Buffer.from("changed");
  await assert.rejects(publishRelease(options)); assert.deepEqual(events, ["local-signatures"]);
});
test("manifest bytes must match the validated metadata", async () => {
  const { options, events } = fixture(); options.manifestBytes = Buffer.from('{}');
  await assert.rejects(publishRelease(options), /MANIFEST_BYTES_MISMATCH/); assert.deepEqual(events, []);
});
test("native video metadata is mandatory", () => {
  const { options } = fixture(); delete options.manifest.native_video;
  assert.throws(() => validateManifest(options.manifest, options.version, options.channel, signer), /INVALID_ARTIFACT_METADATA/);
});
test("development repair packages cannot be published", async () => {
  const { options, events } = fixture(); options.manifest.development_repair_package = true;
  await assert.rejects(publishRelease(options), /INVALID_RELEASE_MANIFEST/); assert.deepEqual(events, []);
});
test("reject unsigned, wrong-channel, traversal and stable development manifests", () => {
  for (const patch of [{ signed: false }, { channel: "stable" }, { architecture: "arm64" }, { trusted_signer_sha256: [] }, { trusted_signer_sha256: [signer, "bad"] }, { msi: { filename: "..\\evil.msi", size: 1, sha256: "a".repeat(64) } }]) {
    const { options } = fixture(); Object.assign(options.manifest, patch);
    assert.throws(() => validateManifest(options.manifest, options.version, options.channel, signer));
  }
  const { options } = fixture(); options.manifest.channel = "stable";
  assert.throws(() => validateManifest(options.manifest, "0.1.6", "stable", signer));
});
test("versions obey exact MSI bounds", () => {
  for (const version of ["01.0.0", "256.0.0", "1.256.0", "1.0.65536", "1.0.0-beta", "1.0.0+build", "1.0.0\n"]) {
    const { options } = fixture(); options.manifest.version = version;
    assert.throws(() => validateManifest(options.manifest, version, "beta", signer));
  }
  const { options } = fixture(); const version = "255.255.65535";
  options.manifest.version = version;
  for (const key of Object.keys(artifacts)) options.manifest[key].version = version;
  validateManifest(options.manifest, version, "beta", signer);
});
test("production publisher requires explicit separate PROD configuration and exact embedded pins", () => {
  const { options } = fixture(undefined, "stable");
  const env = { SENTINELGRID_SIGN_CERT_THUMBPRINT: "B".repeat(40), SENTINELGRID_UPDATE_SIGNER_SHA256: signer };
  validatePublicationProfile(options.manifest, signer, env);
  for (const patch of [{ SENTINELGRID_SIGN_CERT_THUMBPRINT: undefined }, { SENTINELGRID_UPDATE_SIGNER_SHA256: undefined }, { SENTINELGRID_UPDATE_SIGNER_SHA256: "C".repeat(64) }, { SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT: "B".repeat(40) }, { SENTINELGRID_DEV_UPDATE_SIGNER_SHA256: signer }]) {
    assert.throws(() => validatePublicationProfile(options.manifest, signer, { ...env, ...patch }));
  }
  const beta = fixture().options;
  assert.throws(() => validatePublicationProfile(beta.manifest, signer, {}), /ACKNOWLEDGEMENT/);
  validatePublicationProfile(beta.manifest, signer, { SENTINELGRID_PUBLISH_ALLOW_DEVELOPMENT: "true" });
});
function databaseFixture(channel) {
  const expected = { version: "1.0.0", channel, sha256: "a".repeat(64), size_bytes: 42, msi_sha256: "b".repeat(64), msi_size_bytes: 50, updater_sha256: "c".repeat(64), updater_size_bytes: 30, manifest_sha256: "d".repeat(64), signer_sha256: signer, development_build: channel !== "stable" };
  const rows = {
    agent_release_channels: { release_id: "release-id" },
    agent_releases: { id: "release-id", version: "1.0.0", channel, platform: "windows", architecture: "amd64", is_active: true, storage_path: `${channel}/1.0.0/SentinelGridAgent.exe`, sha256: expected.sha256, size_bytes: 42 },
    agent_release_bundles: { ...expected },
  };
  const calls = [];
  const errors = {};
  const admin = { from(table) {
    calls.push(table);
    const query = { select() { return query; }, eq(field, value) {
      assert.equal(field, table === "agent_release_channels" ? "channel" : table === "agent_releases" ? "id" : "release_id");
      assert.equal(value, table === "agent_release_channels" ? channel : "release-id"); return query;
    }, async single() { return { data: rows[table], error: errors[table] }; }, async maybeSingle() { return query.single(); } };
    return query;
  } };
  return { expected, rows, calls, errors, admin };
}
for (const channel of ["dev", "beta", "stable"]) test(`${channel}: channel head, base release and product bundle must agree exactly`, async () => {
  const f = databaseFixture(channel); await verifyPublishedChannel(f.admin, f.expected);
  assert.deepEqual(f.calls, ["agent_release_channels", "agent_releases", "agent_release_bundles"]);
  for (const other of ["dev", "beta", "stable"].filter(value => value !== channel)) {
    f.rows.agent_releases.channel = other;
    await assert.rejects(verifyPublishedChannel(f.admin, f.expected), /DB_MISMATCH/);
  }
});
for (const [table, field, value] of [
  ["agent_release_channels", "release_id", null], ["agent_releases", "version", "0.9.0"], ["agent_releases", "is_active", false],
  ["agent_releases", "sha256", "bad"], ["agent_releases", "storage_path", "beta/1.0.0/SentinelGridAgent.exe"],
  ["agent_release_bundles", "signer_sha256", "B".repeat(64)], ["agent_release_bundles", "msi_size_bytes", 51],
  ["agent_release_bundles", "development_build", true], ["agent_release_bundles", "manifest_sha256", "bad"],
]) test(`DB verification rejects ${table}.${field} mismatch`, async () => {
  const f = databaseFixture("stable"); f.rows[table][field] = value;
  await assert.rejects(verifyPublishedChannel(f.admin, f.expected));
});
for (const table of ["agent_release_channels", "agent_releases", "agent_release_bundles"]) test(`DB verification fails closed on missing/error ${table}`, async () => {
  const f = databaseFixture("stable"); f.errors[table] = { message: "test database error" };
  await assert.rejects(verifyPublishedChannel(f.admin, f.expected));
  delete f.errors[table]; f.rows[table] = null;
  await assert.rejects(verifyPublishedChannel(f.admin, f.expected));
});
