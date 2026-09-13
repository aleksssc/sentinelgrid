import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import tls from "node:tls";

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4_PRIVATE = /^(10\.|127\.|0\. |169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0$)/;

export class DiagnosticError extends Error {}

export function hostnameFromTarget(target: string) {
  const candidate = target.trim().toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME.test(candidate) || candidate.length > 253) throw new DiagnosticError("Enter a valid public hostname.");
  return candidate;
}

function isPublicAddress(address: string) {
  if (isIP(address) === 4) return !IPV4_PRIVATE.test(address) && !address.startsWith("0.") && !address.startsWith("100.64.") && !address.startsWith("198.18.");
  const normalized = address.toLowerCase();
  return !normalized.startsWith("::") && !normalized.startsWith("fc") && !normalized.startsWith("fd") && !normalized.startsWith("fe8") && !normalized.startsWith("fe9") && !normalized.startsWith("fea") && !normalized.startsWith("feb");
}

async function publicAddresses(hostname: string) {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new DiagnosticError("This tool can only connect to public internet hosts.");
  return addresses.map(({ address }) => address);
}

export async function dnsLookup(target: string) {
  const hostname = hostnameFromTarget(target);
  const [addresses, mx, ns, txt] = await Promise.all([
    publicAddresses(hostname),
    dns.resolveMx(hostname).catch(() => []),
    dns.resolveNs(hostname).catch(() => []),
    dns.resolveTxt(hostname).catch(() => []),
  ]);
  return { hostname, addresses, nameservers: ns, mailExchangers: mx.map(({ exchange, priority }) => `${exchange} (${priority})`), textRecords: txt.map((record) => record.join("")) };
}

function urlFromTarget(target: string) {
  let url: URL;
  try { url = new URL(target.trim()); } catch { throw new DiagnosticError("Enter a valid HTTP or HTTPS URL."); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new DiagnosticError("Enter a valid HTTP or HTTPS URL.");
  hostnameFromTarget(url.hostname);
  return url;
}

async function fetchPublicUrl(target: string) {
  const url = urlFromTarget(target);
  await publicAddresses(url.hostname);
  const startedAt = performance.now();
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "SentinelGrid Diagnostics/1.0", Accept: "*/*" } });
  return { url: url.toString(), response, responseTime: Math.round(performance.now() - startedAt) };
}

export async function httpCheck(target: string, includeHeaders = false) {
  const { url, response, responseTime } = await fetchPublicUrl(target);
  const headers = Object.fromEntries([...response.headers.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return { url, status: response.status, statusText: response.statusText, responseTime, redirected: response.status >= 300 && response.status < 400 ? response.headers.get("location") : null, ...(includeHeaders ? { headers } : {}) };
}

export async function sslInspect(target: string) {
  const hostname = hostnameFromTarget(target.replace(/^https?:\/\//, "").split("/")[0].split(":")[0]);
  await publicAddresses(hostname);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      if (!certificate?.subject) return reject(new DiagnosticError("No TLS certificate was returned."));
      resolve({ hostname, subject: certificate.subject.CN ?? "Not available", issuer: certificate.issuer?.O ?? certificate.issuer?.CN ?? "Not available", validFrom: certificate.valid_from, validTo: certificate.valid_to, protocol: socket.getProtocol() ?? "Not available", valid: new Date(certificate.valid_to).getTime() > Date.now() });
    });
    socket.once("timeout", () => { socket.destroy(); reject(new DiagnosticError("The TLS connection timed out.")); });
    socket.once("error", (error) => reject(new DiagnosticError(`Unable to inspect this certificate: ${error.message}`)));
  });
}

export async function whoisLookup(target: string) {
  const hostname = hostnameFromTarget(target);
  const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(hostname)}`, { headers: { Accept: "application/rdap+json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new DiagnosticError(response.status === 404 ? "No registration data was found for this domain." : "WHOIS data is temporarily unavailable.");
  const data = await response.json() as { handle?: string; status?: string[]; events?: { eventAction?: string; eventDate?: string }[]; entities?: { roles?: string[]; vcardArray?: [string, [string, unknown, string, string][]] }[] };
  const registrar = data.entities?.find((entity) => entity.roles?.includes("registrar"))?.vcardArray?.[1].find(([field]) => field === "fn")?.[3] ?? "Not available";
  const event = (action: string) => data.events?.find(({ eventAction }) => eventAction === action)?.eventDate ?? "Not available";
  return { domain: hostname, handle: data.handle ?? "Not available", registrar, created: event("registration"), expires: event("expiration"), updated: event("last changed"), status: data.status?.join(", ") ?? "Not available" };
}

export async function reverseDns(target: string) {
  const address = target.trim();
  if (!isIP(address) || !isPublicAddress(address)) throw new DiagnosticError("Enter a valid public IP address.");
  return { address, hostnames: await dns.reverse(address).catch(() => []) };
}

export function subnetCalculate(target: string) {
  const [address, prefixValue] = target.trim().split("/");
  const prefix = Number(prefixValue);
  if (!address || !Number.isInteger(prefix) || prefix < 0 || prefix > 32 || isIP(address) !== 4) throw new DiagnosticError("Enter an IPv4 CIDR, for example 192.0.2.0/24.");
  const number = address.split(".").reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
  if (address.split(".").some((part) => !/^\d+$/.test(part) || Number(part) > 255)) throw new DiagnosticError("Enter an IPv4 CIDR, for example 192.0.2.0/24.");
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = number & mask;
  const broadcast = network | (~mask >>> 0);
  const format = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
  const hosts = prefix >= 31 ? (prefix === 31 ? 2 : 1) : 2 ** (32 - prefix) - 2;
  return { network: `${format(network)}/${prefix}`, netmask: format(mask), broadcast: format(broadcast >>> 0), usableHosts: hosts.toLocaleString(), range: prefix >= 31 ? "Not applicable" : `${format(network + 1)} - ${format(broadcast - 1)}` };
}
