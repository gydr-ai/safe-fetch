import { DEFAULT_LABEL, DEFAULT_MAX_LENGTH } from "../constants/defaults.js"
import { UnsafeUrlError, UnsafeUrlReason } from "../errors/unsafe-url-error.js"
import { isBlockedHostname } from "../helpers/blocked-hostname.js"
import { hasEmptyLabel } from "../helpers/hostname-labels.js"
import { ipVersion, normalizeAddress } from "../helpers/ip.js"
import { portOf } from "../helpers/port-of.js"
import type { UrlPolicy } from "../interfaces/url-policy.js"

/**
 * The error for a URL whose scheme the policy does not allow.
 *
 * @param label - the URL's name in the message.
 * @param httpAllowed - whether `http:` is allowed, which changes the message.
 * @returns the error to throw.
 */
function protocolNotAllowed(
  label: string,
  httpAllowed: boolean,
): UnsafeUrlError {
  return new UnsafeUrlError(
    UnsafeUrlReason.PROTOCOL_NOT_ALLOWED,
    httpAllowed
      ? `${label} must use the http: or https: scheme`
      : `${label} must use the https: scheme`,
  )
}

/**
 * Validate a URL against a policy and a caller-chosen address policy,
 * without touching the network. The checks run in a fixed order: length
 * (before parsing, so a huge input costs nothing), syntax, scheme,
 * credentials, port, then host. A hostname with an empty label (`a..b`) is
 * malformed.
 *
 * @param input - the URL to check.
 * @param policy - the URL policy.
 * @param isBlocked - returns `true` for an IP literal that must be refused.
 * @param isRefusedHostname - optional extra hostname rules; returns `true`
 *   for a hostname that must be refused. It can only refuse more.
 * @returns the parsed URL.
 * @throws {UnsafeUrlError} when any check fails.
 * @internal
 */
export function checkUrl(
  input: string | URL,
  policy: UrlPolicy,
  isBlocked: (address: string) => boolean,
  isRefusedHostname?: (hostname: string) => boolean,
): URL {
  const label = policy.label ?? DEFAULT_LABEL
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

  switch (url.protocol) {
    case "https:":
      break
    case "http:":
      if (!httpAllowed) throw protocolNotAllowed(label, httpAllowed)
      break
    default:
      throw protocolNotAllowed(label, httpAllowed)
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

  if (host !== "" && ipVersion(host) === 0 && hasEmptyLabel(host)) {
    throw new UnsafeUrlError(
      UnsafeUrlReason.MALFORMED_URL,
      `${label} has an empty hostname label`,
    )
  }

  if (
    host === "" ||
    isBlockedHostname(host) ||
    isRefusedHostname?.(host) === true ||
    (ipVersion(host) !== 0 && isBlocked(host))
  ) {
    throw new UnsafeUrlError(
      UnsafeUrlReason.BLOCKED_ADDRESS,
      `${label} targets a blocked host or address range`,
    )
  }

  return url
}
