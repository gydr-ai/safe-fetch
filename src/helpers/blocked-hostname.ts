import { BLOCKED_HOSTNAMES } from "../constants/blocked-hostnames.js"

/**
 * Whether a hostname is refused before any lookup: a known metadata name,
 * `localhost`, or a subdomain of `localhost` (RFC 6761 § 6.3). A single
 * trailing dot (the fully qualified form) is ignored.
 *
 * @param hostname - a lower-cased hostname.
 * @returns `true` when the hostname must not be resolved or dialled.
 * @internal
 */
export function isBlockedHostname(hostname: string): boolean {
  const name = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname

  return BLOCKED_HOSTNAMES.has(name) || name.endsWith(".localhost")
}
