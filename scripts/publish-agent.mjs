import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const artifactKeys = ["agent", "updater", "rdp_client", "native_video", "msi"];
const names = {
  agent: "SentinelGridAgent.exe",
  updater: "SentinelGridUpdater.exe",
  rdp_client: "SentinelGridRDP.exe",
  native_video: "SentinelGridVideo.dll",
  msi: "SentinelGridAgent.msi",
};

export function validateManifest(manifest, version, channel, signer) {
  const parts = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(version);
  if (!parts || parts[0] !== version || Number(parts[1]) > 255 || Number(parts[2]) > 255 || Number(parts[3]) > 65535 ||
      !["dev", "beta", "stable"].includes(channel) ||
      !/^[A-F0-9]{64}$/.test(signer) || manifest.schema_version !== 1 || manifest.product !== "SentinelGridAgent" ||
      manifest.version !== version || manifest.channel !== channel || manifest.platform !== "windows" ||
      manifest.architecture !== "amd64" || manifest.signed !== true || typeof manifest.development_update_build !== "boolean" ||
      manifest.development_repair_package === true ||
      manifest.installation_artifact !== "msi" || manifest.update_protocol !== 2 ||
      !Array.isArray(manifest.trusted_signer_sha256) || !manifest.trusted_signer_sha256.includes(signer) ||
      manifest.trusted_signer_sha256.some((pin) => !/^[A-F0-9]{64}$/.test(pin)) ||
      (channel === "stable" && manifest.development_update_build)) throw new Error("INVALID_RELEASE_MANIFEST");
  httpsOrigin(manifest.server_url, "MANIFEST_SERVER_URL");
  for (const key of artifactKeys) {
    const entry = manifest[key];
    if (!entry || entry.version !== version || entry.filename !== names[key] || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 268435456) throw new Error("INVALID_ARTIFACT_METADATA");
  }
}

export function validatePublicationProfile(manifest, signer, env) {
  if (manifest.channel !== "stable") {
    if (manifest.development_update_build && env.SENTINELGRID_PUBLISH_ALLOW_DEVELOPMENT !== "true") throw new Error("ISOLATED_DEVELOPMENT_BACKEND_ACKNOWLEDGEMENT_REQUIRED");
    return;
  }
  const pins = env.SENTINELGRID_UPDATE_SIGNER_SHA256;
  if (!/^[a-fA-F0-9]{40}$/.test(env.SENTINELGRID_SIGN_CERT_THUMBPRINT ?? "") ||
      !/^[a-fA-F0-9]{64}(,[a-fA-F0-9]{64})*$/.test(pins ?? "") ||
      !pins.toUpperCase().split(",").includes(signer) || manifest.trusted_signer_sha256.join(",") !== pins.toUpperCase()) {
    throw new Error("PRODUCTION_SIGNER_NOT_CONFIGURED_OR_PIN_MISMATCH");
  }
  if (env.SENTINELGRID_SIGN_CERT_THUMBPRINT.toUpperCase() === env.SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT?.toUpperCase() ||
      manifest.trusted_signer_sha256.includes(env.SENTINELGRID_DEV_UPDATE_SIGNER_SHA256?.toUpperCase())) throw new Error("PRODUCTION_CANNOT_TRUST_DEVELOPMENT_SIGNER");
}

export async function verifyPublishedChannel(admin, expected) {
  const { data: head, error: headError } = await admin.from("agent_release_channels")
    .select("release_id").eq("channel", expected.channel).maybeSingle();
  if (headError || !head?.release_id) throw new Error("PUBLISHED_CHANNEL_HEAD_VERIFICATION_FAILED");
  const { data: release, error: releaseError } = await admin.from("agent_releases")
    .select("id, version, channel, platform, architecture, is_active, storage_path, sha256, size_bytes")
    .eq("id", head.release_id).single();
  if (releaseError || !release || release.id !== head.release_id || release.version !== expected.version ||
      release.channel !== expected.channel || release.platform !== "windows" || release.architecture !== "amd64" ||
      release.is_active !== true || release.storage_path !== `${expected.channel}/${expected.version}/SentinelGridAgent.exe` ||
      release.sha256 !== expected.sha256 || release.size_bytes !== expected.size_bytes) throw new Error("PUBLISHED_RELEASE_DB_MISMATCH");
  const { data: bundle, error: bundleError } = await admin.from("agent_release_bundles")
    .select("msi_sha256, msi_size_bytes, updater_sha256, updater_size_bytes, manifest_sha256, signer_sha256, development_build")
    .eq("release_id", head.release_id).single();
  if (bundleError || !bundle || ["msi_sha256", "msi_size_bytes", "updater_sha256", "updater_size_bytes", "manifest_sha256", "signer_sha256", "development_build"]
    .some((key) => bundle[key] !== expected[key])) throw new Error("PUBLISHED_BUNDLE_DB_MISMATCH");
}

// Dependency injection keeps failure-ordering tests isolated from hosted infrastructure.
export async function publishRelease({ manifest, manifestBytes, version, channel, signer, readArtifact, validateLocal,
  upload, download, validateStored, activate, verifyChannel, verifyWebsite }) {
  validateManifest(manifest, version, channel, signer);
  if (JSON.stringify(JSON.parse(manifestBytes)) !== JSON.stringify(manifest)) throw new Error("MANIFEST_BYTES_MISMATCH");
  await validateLocal();
  const files = [];
  for (const key of artifactKeys) {
    const entry = manifest[key];
    const bytes = await readArtifact(entry.filename);
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error("LOCAL_ARTIFACT_CHANGED");
    files.push({ ...entry, bytes });
  }
  files.push({ filename: "manifest.json", bytes: manifestBytes, size: manifestBytes.length, sha256: digest(manifestBytes) });
  const checksums = await readArtifact("checksums.txt");
  if (checksums.length > 16384) throw new Error("INVALID_CHECKSUM_FILE");
  files.push({ filename: "checksums.txt", bytes: checksums, size: checksums.length, sha256: digest(checksums) });
  for (const file of files) {
    const path = `${channel}/${version}/${file.filename}`;
    await upload(path, file.bytes);
    const stored = await download(path, file.size);
    if (stored.length !== file.size || digest(stored) !== file.sha256) throw new Error("STORED_ARTIFACT_MISMATCH");
    await validateStored(file.filename, stored);
  }
  await validateStored();
  const release = { version, channel, sha256: manifest.agent.sha256, size_bytes: manifest.agent.size,
    msi_sha256: manifest.msi.sha256, msi_size_bytes: manifest.msi.size,
    updater_sha256: manifest.updater.sha256, updater_size_bytes: manifest.updater.size,
    manifest_sha256: digest(manifestBytes), signer_sha256: signer, development_build: manifest.development_update_build };
  await activate(release);
  await verifyChannel(release);
  await verifyWebsite();
  await verifyChannel(release);
}

function httpsOrigin(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label}_REQUIRED`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error(`${label}_MUST_BE_HTTPS_ORIGIN`);
  return url;
}
async function boundedDownload(url, expected, headers = {}) {
  const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error("DOWNLOAD_FAILED");
  const length = response.headers.get("content-length");
  if (length && Number(length) !== expected) { await response.body.cancel(); throw new Error("DOWNLOAD_SIZE_MISMATCH"); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > expected) throw new Error("DOWNLOAD_EXCEEDS_EXPECTED_SIZE");
    chunks.push(chunk);
  }
  if (size !== expected) throw new Error("DOWNLOAD_SIZE_MISMATCH");
  return { bytes: Buffer.concat(chunks), disposition: response.headers.get("content-disposition") };
}
async function main() {
  const [directoryArg, version, channel, signer] = process.argv.slice(2);
  if (!directoryArg || !version || !channel || !signer || process.argv.length !== 6) throw new Error("USAGE: node scripts\\publish-agent.mjs DIRECTORY VERSION CHANNEL SIGNER_SHA256");
  const directory = resolve(directoryArg);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const backend = httpsOrigin(process.env.SENTINELGRID_PUBLISH_SUPABASE_URL, "PUBLISH_SUPABASE_URL");
  const website = httpsOrigin(process.env.SENTINELGRID_PUBLISH_WEBSITE_URL, "PUBLISH_WEBSITE_URL");
  const key = process.env.SENTINELGRID_PUBLISH_SERVICE_ROLE_KEY;
  const enrollmentToken = process.env.SENTINELGRID_PUBLISH_ENROLLMENT_TOKEN;
  if (!key || !/^SG-ENROLL-[a-f0-9]{64}$/.test(enrollmentToken ?? "")) throw new Error("PUBLISH_CREDENTIALS_AND_UNUSED_ENROLLMENT_TOKEN_REQUIRED");
  const manifestBytes = await readFile(join(directory, "manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  validateManifest(manifest, version, channel, signer);
  validatePublicationProfile(manifest, signer, process.env);
  if (new URL(manifest.server_url).origin !== website.origin) throw new Error("MSI_ENROLLMENT_ORIGIN_MUST_MATCH_WEBSITE");
  const admin = createClient(backend.href, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const storage = admin.storage.from("agent-releases");
  const { data: bucket, error: bucketError } = await admin.storage.getBucket("agent-releases");
  if (bucketError || !bucket || bucket.public) throw new Error("PRIVATE_RELEASE_BUCKET_REQUIRED");
  async function verifyEnrollmentContext() {
    const { data: token, error: tokenError } = await admin.from("agent_enrollment_tokens")
      .select("organization_id, expires_at, used_at, revoked_at").eq("token_hash", digest(enrollmentToken)).maybeSingle();
    if (tokenError || !token || token.used_at || token.revoked_at || !Number.isFinite(Date.parse(token.expires_at)) || Date.parse(token.expires_at) < Date.now() + 180000) throw new Error("VALID_WEBSITE_ENROLLMENT_TOKEN_REQUIRED_WITH_THREE_MINUTES_REMAINING");
    const { data: policy, error: policyError } = await admin.from("organization_agent_update_settings")
      .select("channel").eq("organization_id", token.organization_id).maybeSingle();
    if (policyError || (policy?.channel ?? "stable") !== channel) throw new Error("WEBSITE_TEST_TOKEN_CHANNEL_MISMATCH");
  }
  await verifyEnrollmentContext();
  const { data: existing, error: existingError } = await admin.from("agent_releases")
    .select("id").eq("channel", channel).eq("version", version).eq("platform", "windows").eq("architecture", "amd64").maybeSingle();
  if (existingError) throw new Error("IMMUTABLE_RELEASE_PREFLIGHT_FAILED");
  if (existing) throw new Error("RELEASE_ALREADY_PUBLISHED_IMMUTABLE_CHECK_PREVIOUS_PUBLICATION_EVIDENCE");
  const evidence = join(root, "dist", "validation", `publish-${channel}-${version}-${randomUUID()}`);
  await mkdir(evidence, { recursive: true });
  function validate(dir, websiteMSI) {
    const args = ["-NoProfile", "-NonInteractive", "-File", join(root, "scripts", "validate-agent-release.ps1"),
      "-ArtifactDirectory", dir, "-ExpectedVersion", version, "-ExpectedChannel", channel, "-ExpectedSignerSHA256", signer];
    if (channel === "stable") args.push("-ExpectedCertificateThumbprint", process.env.SENTINELGRID_SIGN_CERT_THUMBPRINT);
    if (websiteMSI) args.push("-WebsiteMSI", websiteMSI);
    const result = spawnSync("powershell.exe", args, { stdio: "inherit", windowsHide: true });
    if (result.error || result.status !== 0) throw new Error("WINDOWS_RELEASE_VALIDATION_FAILED");
  }
  await publishRelease({ manifest, manifestBytes, version, channel, signer,
    readArtifact: (filename) => readFile(join(directory, filename)),
    validateLocal: () => validate(directory),
    upload: async (path, bytes) => {
      const { error } = await storage.upload(path, bytes, { upsert: false, contentType: "application/octet-stream", cacheControl: "31536000" });
      if (error && String(error.statusCode) !== "409") throw new Error("IMMUTABLE_ARTIFACT_UPLOAD_FAILED");
      // Resume an interrupted upload only when existing bytes independently verify below.
      if (error) console.log("Existing immutable object: verifying before resuming.");
    },
    download: async (path, size) => {
      const { data, error } = await storage.createSignedUrl(path, 180);
      if (error || !data) throw new Error("STORAGE_VERIFICATION_URL_FAILED");
      const url = new URL(data.signedUrl);
      if (url.protocol !== "https:" || url.origin !== backend.origin || url.username || url.password) throw new Error("UNTRUSTED_STORAGE_ORIGIN");
      return (await boundedDownload(url, size)).bytes;
    },
    validateStored: (filename, bytes) => filename ? writeFile(join(evidence, filename), bytes, { flag: "wx" }) : validate(evidence),
    activate: async (release) => {
      await verifyEnrollmentContext();
      const { error } = await admin.rpc("publish_agent_release", { p_release: release });
      if (error) throw new Error("PUBLICATION_COMMIT_FAILED_OR_UNACKNOWLEDGED_CHECK_CHANNEL_STATE");
    },
    verifyChannel: async (release) => {
      await verifyEnrollmentContext();
      await verifyPublishedChannel(admin, release);
    },
    verifyWebsite: async () => {
      const url = new URL("/api/agent/download", website);
      url.searchParams.set("token", enrollmentToken);
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20000) });
      if (response.status !== 302 || response.headers.get("x-sentinelgrid-version") !== version || response.headers.get("x-sentinelgrid-channel") !== channel) throw new Error("PUBLISHED_BUT_WEBSITE_VERSION_VERIFICATION_FAILED");
      const location = new URL(response.headers.get("location") ?? "");
      if (location.protocol !== "https:" || location.origin !== backend.origin || location.username || location.password || location.hash ||
          location.pathname !== `/storage/v1/object/sign/agent-releases/${channel}/${version}/SentinelGridAgent.msi` ||
          location.searchParams.get("download") !== `SentinelGridAgent__${enrollmentToken}.msi`) throw new Error("PUBLISHED_BUT_WEBSITE_STORAGE_OR_FILENAME_INVALID");
      const downloaded = await boundedDownload(location, manifest.msi.size);
      if (!downloaded.disposition?.includes(`SentinelGridAgent__${enrollmentToken}.msi`) || digest(downloaded.bytes) !== manifest.msi.sha256) throw new Error("PUBLISHED_BUT_WEBSITE_MSI_MISMATCH");
      const path = join(evidence, "website-SentinelGridAgent.msi");
      await writeFile(path, downloaded.bytes, { flag: "wx" });
      validate(evidence, path);
    },
  });
  await writeFile(join(evidence, "receipt.json"), JSON.stringify({ version, channel, signer_sha256: signer,
    website_msi_sha256: manifest.msi.sha256, channel_head_verified: true, website_filename_verified: true, verified_at: new Date().toISOString() }, null, 2), { flag: "wx" });
  console.log(`PUBLISHED AND WEBSITE VERIFIED: ${version} ${channel}. Evidence: ${evidence}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // SDK/network error objects can contain credentials or signed URLs; never print them.
    const message = error instanceof Error && /^[A-Z0-9_: .\\]+$/.test(error.message) ? error.message : "RELEASE_PUBLISH_FAILED";
    console.error(message);
    process.exitCode = 1;
  });
}
