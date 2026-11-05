import { ipVersion, isBlockedAddress, normalizeAddress } from "./address.js"

/** Why {@link assertSafeUrl} refused a URL. Stable values; branch on these. */
export const UnsafeUrlReason = {
  URL_TOO_LONG: "url_too_long",
  MALFORMED_URL: "malformed_url",
  PROTOCOL_NOT_ALLOWED: "protocol_not_allowed",
  CREDENTIALS_IN_URL: "credentials_in_url",
  PORT_NOT_ALLOWED: "port_not_allowed",
  BLOCKED_ADDRESS: "blocked_address",
} as const

export type UnsafeUrlReason =
  (typeof UnsafeUrlReason)[keyof typeof UnsafeUrlReason]

/** A URL refused by {@link assertSafeUrl}. */
export class UnsafeUrlError extends Error {
  override readonly name = "UnsafeUrlError"
  readonly reason: UnsafeUrlReason

  constructor(reason: UnsafeUrlReason, message: string) {
    super(message)
    this.reason = reason
  }
}

/** Options shared by every guard in this package. */
export interface UrlPolicy {
  /** Accept `http:` as well as `https:`. Default `false` (HTTPS only). */
  allowHttp?: boolean
  /** Refuse URLs longer than this many characters. Default 2048. */
  maxLength?: number
  /**
   * Only these ports may be dialled. Default: any port. Pass `[443]` (or
   * `[80, 443]`) when you only ever expect standard web servers.
   */
  allowedPorts?: readonly number[]
  /** Name used in error messages, e.g. `"Webhook URL"`. Default `"URL"`. */
  label?: string
}

const DEFAULT_MAX_LENGTH = 2048

/**
 * Hostnames refused before any DNS lookup. `localhost` and its subdomains
 * resolve to loopback by RFC 6761; the others are cloud metadata services
 * that answer on link-local addresses some resolvers hand out.
 */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
])

function isBlockedHostname(hostname: string): boolean {
  const name = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname

  return BLOCKED_HOSTNAMES.has(name) || name.endsWith(".localhost")
}

function portOf(url: URL): number {
  if (url.port !== "") return Number(url.port)

  return url.protocol === "https:" ? 443 : 80
}

/**
 * Validate a URL without touching the network.
 *
 * Checks length, syntax, protocol, embedded credentials, port, blocked
 * hostnames and IP literals (in every notation the WHATWG URL parser
 * accepts, including IPv4 inside IPv6). It does NOT resolve DNS, so a
 * hostname that passes may still point at a private address: use
 * {@link resolveSafeUrl} or `safeFetch` before connecting.
 *
 * @returns the parsed URL.
 * @throws {UnsafeUrlError}
 */
export function assertSafeUrl(
  input: string | URL,
  policy: UrlPolicy = {},
): URL {
  return checkUrl(input, policy, isBlockedAddress)
}

/** @internal {@link assertSafeUrl} with a caller-chosen address policy. */
export function checkUrl(
  input: string | URL,
  policy: UrlPolicy,
  isBlocked: (address: string) => boolean,
): URL {
  const label = policy.label ?? "URL"
  const text = typeof input === "string" ? input : input.href
  const maxLength = policy.maxLength ?? DEFAULT_MAX_LENGTH

  if (text.length > maxLength) {
    throw new UnsafeUrlError(
      UnsafeUrlReason.URL_TOO_LONG,
      `${label} is longer than ${maxLength} characters`,
    )
  }

  let url: URL

  try {
    url = new URL(text)
  } catch {
    throw new UnsafeUrlError(
      UnsafeUrlReason.MALFORMED_URL,
      `${label} cannot be parsed as a URL`,
    )
  }

  const httpAllowed = policy.allowHttp === true

  if (url.protocol !== "https:" && !(httpAllowed && url.protocol === "http:")) {
    throw new UnsafeUrlError(
      UnsafeUrlReason.PROTOCOL_NOT_ALLOWED,
      httpAllowed
        ? `${label} must use the http: or https: scheme`
        : `${label} must use the https: scheme`,
    )
  }

  if (url.username !== "" || url.password !== "") {
    throw new UnsafeUrlError(
      UnsafeUrlReason.CREDENTIALS_IN_URL,
      `${label} must not contain credentials`,
    )
  }

  if (
    policy.allowedPorts !== undefined &&
    !policy.allowedPorts.includes(portOf(url))
  ) {
    throw new UnsafeUrlError(
      UnsafeUrlReason.PORT_NOT_ALLOWED,
      `${label} uses a port that is not allowed`,
    )
  }

  const host = normalizeAddress(url.hostname)

  if (
    host === "" ||
    isBlockedHostname(host) ||
    (ipVersion(host) !== 0 && isBlocked(host))
  ) {
    throw new UnsafeUrlError(
      UnsafeUrlReason.BLOCKED_ADDRESS,
      `${label} targets a blocked host or address range`,
    )
  }

  return url
}
