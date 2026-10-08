import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { publicOrigin } from "./checks.mjs";

const DENIED_SUBNETS = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
  "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15",
  "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4"
];

export function sandboxPolicy(hostname) {
  return { allow: [hostname], subnets: { deny: DENIED_SUBNETS } };
}

export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return !(lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") ||
      lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") ||
      lower.startsWith("ff") || lower.startsWith("2001:db8") || lower.startsWith("::ffff:"));
  }
  return false;
}

export async function assertPublicTarget(site, lookupImpl = lookup) {
  const hostname = new URL(publicOrigin(site)).hostname;
  const addresses = await lookupImpl(hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((item) => !publicAddress(item.address))) {
    throw new Error("Target must resolve only to public internet addresses");
  }
  return hostname;
}
