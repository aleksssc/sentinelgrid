import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { publishRelease, validateManifest } from "./publish-agent.mjs";
const hash = (data) => createHash("sha256").update(data).digest("hex");
const signer = "A".repeat(64);
function fixture(failure) {
 const events = [];
 const manifest = { schema_version: 1, server_url: "https://isolated.example", product: "SentinelGridAgent", version: "0.1.6", channel: "beta", platform: "windows", architecture: "amd64", signed: true, development_update_build: true, trusted_signer_sha256: [signer] };
 const bytes = Buffer.from("isolated test artifact, not an executable");
 manifest.installation_artifact = "msi"; manifest.update_protocol = 2;
 for (const [key, filename] of Object.entries({ agent: "SentinelGridAgent.exe", updater: "SentinelGridUpdater.exe", rdp_client: "SentinelGridRDP.exe", msi: "SentinelGridAgent.msi" })) manifest[key] = { filename, version: manifest.version, sha256: hash(bytes), size: bytes.length };
 const manifestBytes = Buffer.from(JSON.stringify(manifest));
 const step = (name) => { events.push(name); if (failure === name) throw new Error(name); };
 return { events, options: { manifest, manifestBytes, version: "0.1.6", channel: "beta", signer,
  readArtifact: async () => bytes,
  validateLocal: async () => step("local-signatures"),
  upload: async (path) => step(`upload:${path.split("/").at(-1)}`),
  download: async (path) => { step(`download:${path.split("/").at(-1)}`); return failure === "bad-download" ? Buffer.from("bad") : path.endsWith("manifest.json") ? manifestBytes : bytes; },
  validateStored: async (name) => { if (!name) step("stored-signatures"); },
  activate: async (release) => { assert.equal(release.channel, "beta"); assert.equal(release.manifest_sha256, hash(manifestBytes)); step("activate"); },
  verifyWebsite: async () => step("website"),
 } };
}
test("publication activates only after every uploaded artifact and stored signature validates", async () => {
 const { options, events } = fixture(); await publishRelease(options);
 assert.equal(events.filter(e => e.startsWith("upload:")).length, 6);
 assert.equal(events.filter(e => e.startsWith("download:")).length, 6);
 assert.deepEqual(events.slice(-3), ["stored-signatures", "activate", "website"]);
});
for (const failure of ["local-signatures", "upload:SentinelGridAgent.exe", "upload:SentinelGridUpdater.exe", "upload:SentinelGridAgent.msi", "download:SentinelGridAgent.msi", "upload:manifest.json", "stored-signatures", "bad-download"]) {
 test(`publication cannot activate on ${failure}`, async () => {
  const { options, events } = fixture(failure); await assert.rejects(publishRelease(options));
  assert.ok(!events.includes("activate")); assert.ok(!events.includes("website"));
 });
}
test("a website failure after commit is not reported as a successful publish", async () => {
 const { options, events } = fixture("website"); await assert.rejects(publishRelease(options)); assert.ok(events.includes("activate"));
});
test("local tampering cannot activate or upload", async () => {
 const { options, events } = fixture(); options.readArtifact = async () => Buffer.from("changed");
 await assert.rejects(publishRelease(options)); assert.deepEqual(events, ["local-signatures"]);
});
test("development repair packages cannot be published", async () => {
 const { options, events } = fixture();
 options.manifest.development_repair_package = true;
 await assert.rejects(publishRelease(options), /INVALID_RELEASE_MANIFEST/);
 assert.deepEqual(events, []);
});
test("reject unsigned, wrong-channel, traversal and stable development manifests", () => {
 for (const patch of [{ signed: false }, { channel: "stable" }, { architecture: "arm64" }, { trusted_signer_sha256: [] }, { msi: { filename: "..\\evil.msi", size: 1, sha256: "a".repeat(64) } }]) {
  const { options } = fixture(); Object.assign(options.manifest, patch);
  assert.throws(() => validateManifest(options.manifest, options.version, options.channel, options.signer));
 }
 const { options } = fixture(); options.manifest.channel = "stable";
 assert.throws(() => validateManifest(options.manifest, "0.1.6", "stable", signer));
});
