import { createHash } from "node:crypto";
import { type AgentRelease } from "./update-policy";

export type ProductRelease = AgentRelease & {
  msi_sha256: string;
  msi_size_bytes: number;
  manifest_sha256: string;
  signer_sha256: string;
};

export function productArtifact(release: ProductRelease, bytes: Uint8Array) {
  if (bytes.byteLength > 16384 || !/^[a-f0-9]{64}$/i.test(release.manifest_sha256) ||
      createHash("sha256").update(bytes).digest("hex") !== release.manifest_sha256.toLowerCase()) {
    throw new Error("RELEASE_MANIFEST_HASH_MISMATCH");
  }
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_PRODUCT_RELEASE");
  const manifest = value as Record<string, unknown>;
  if (manifest.product !== "SentinelGridAgent" || manifest.schema_version !== 1 || manifest.version !== release.version ||
      manifest.channel !== release.channel || manifest.platform !== "windows" || manifest.architecture !== "amd64" ||
      manifest.signed !== true || manifest.development_repair_package === true || manifest.update_protocol !== 2 ||
      manifest.installation_artifact !== "msi" || typeof manifest.development_update_build !== "boolean" ||
      (release.channel === "stable" && manifest.development_update_build) || !/^[a-f0-9]{64}$/i.test(release.signer_sha256) ||
      !Array.isArray(manifest.trusted_signer_sha256) || !manifest.trusted_signer_sha256.includes(release.signer_sha256.toUpperCase())) {
    throw new Error("PRODUCT_MSI_BOOTSTRAP_REQUIRED");
  }
  const names = {
    agent: "SentinelGridAgent.exe",
    updater: "SentinelGridUpdater.exe",
    rdp_client: "SentinelGridRDP.exe",
    native_video: "SentinelGridVideo.dll",
    msi: "SentinelGridAgent.msi",
  };
  for (const [key, filename] of Object.entries(names)) {
    const entry = manifest[key];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("INVALID_PRODUCT_COMPONENT");
    const item = entry as Record<string, unknown>;
    if (item.version !== release.version || item.filename !== filename || typeof item.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/i.test(item.sha256) || typeof item.size !== "number" || !Number.isSafeInteger(item.size) || item.size <= 0 || item.size > 268435456) {
      throw new Error("PRODUCT_VERSION_OR_ARTIFACT_MISMATCH");
    }
    if (key === "msi" && (item.sha256 !== release.msi_sha256 || item.size !== release.msi_size_bytes)) {
      throw new Error("PUBLISHED_MSI_METADATA_MISMATCH");
    }
  }
  return { storage_path: `${release.channel}/${release.version}/SentinelGridAgent.msi`, sha256: release.msi_sha256,
    size_bytes: release.msi_size_bytes, signer_sha256: release.signer_sha256.toUpperCase(), artifact_type: "msi", update_protocol: 2 };
}
