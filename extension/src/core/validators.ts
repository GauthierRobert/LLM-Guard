/**
 * Validators for PII matches — used as `validate` hooks on PII patterns and
 * as standalone guards.
 */

/** Standard Luhn mod-10 check. Strips non-digits; false if fewer than 2 digits. */
export function luhnCheck(s: string): boolean {
  const digits = s.replace(/\D/g, "");
  if (digits.length < 2) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * True for a strict dotted-quad IPv4: exactly 4 octets, each 0–255, no leading
 * zeros (so "01.0.0.1" and version strings are rejected).
 */
export function isValidIPv4(s: string): boolean {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part[0] === "0") return false;
    const n = Number(part);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

/**
 * Heuristic JWT check: base64url-decode the first segment, JSON.parse it, and
 * require an `alg` field. Any failure → false.
 */
export function looksLikeJwt(s: string): boolean {
  try {
    const first = s.split(".")[0];
    if (!first) return false;
    let b64 = first.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const json = atob(b64);
    const header = JSON.parse(json) as Record<string, unknown>;
    return typeof header === "object" && header !== null && "alg" in header;
  } catch {
    return false;
  }
}

/**
 * True if the email's domain is RFC-2606 reserved
 * (example.com/net/org, or ends with .example/.test/.invalid/.localhost).
 */
export function isReservedExampleEmail(s: string): boolean {
  const at = s.lastIndexOf("@");
  if (at === -1) return false;
  const domain = s.slice(at + 1).toLowerCase();
  if (domain === "example.com" || domain === "example.net" || domain === "example.org") {
    return true;
  }
  return (
    domain.endsWith(".example") ||
    domain.endsWith(".test") ||
    domain.endsWith(".invalid") ||
    domain.endsWith(".localhost")
  );
}
