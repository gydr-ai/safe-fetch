import { isBlockedAddress } from "../address/is-blocked-address.js"
import { pickOptions } from "../helpers/options.js"
import type { UrlPolicy } from "../interfaces/url-policy.js"
import { checkUrl } from "./check-url.js"

/**
 * Validate a URL without touching the network.
 *
 * Checks length, syntax, protocol, embedded credentials, port, blocked
 * hostnames and IP literals (in every notation the WHATWG URL parser
 * accepts, including IPv4 inside IPv6). It does NOT resolve DNS, so a
 * hostname that passes may still point at a private address: use
 * `resolveSafeUrl` or `safeFetch` before connecting.
 *
 * @param input - the URL to check, as a string or `URL`.
 * @param policy - the URL policy; every field is optional.
 * @returns the parsed URL.
 * @throws {UnsafeUrlError} when the URL breaks the policy.
 * @throws {TypeError} when a policy field holds an invalid value.
 * @example
 * ```ts
 * const url = assertSafeUrl(userInput, { label: "Webhook URL" })
 * // throws UnsafeUrlError for "http://127.0.0.1", "https://localhost", ...
 * ```
 */
export function assertSafeUrl(
  input: string | URL,
  policy: UrlPolicy = {},
): URL {
  return checkUrl(input, pickOptions(policy), isBlockedAddress)
}
