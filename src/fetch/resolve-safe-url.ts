import { DEFAULT_LABEL } from "../constants/defaults.js"
import { normalizeAddress } from "../helpers/ip.js"
import { pickOptions } from "../helpers/options.js"
import type { ResolvedAddress } from "../interfaces/resolved-address.js"
import type { UrlPolicy } from "../interfaces/url-policy.js"
import { checkUrl } from "../url/check-url.js"
import { defaultDependencies } from "./dependencies.js"
import { resolveHost } from "./resolve-host.js"

/**
 * Validate a URL and every address its hostname currently resolves to,
 * without making a request. Use it only when another library owns the
 * socket: the check and that library's own lookup are separate, so a
 * rebinding window remains. Prefer `safeFetch` whenever you can.
 *
 * @param input - the URL to check.
 * @param policy - the URL policy; every field is optional.
 * @returns the parsed URL and every address it resolved to.
 * @throws {UnsafeUrlError} the URL, or an address it resolved to, is refused.
 * @throws {SafeFetchError} `DNS_FAILURE` when the hostname does not resolve.
 * @throws {TypeError} when a policy field holds an invalid value.
 * @example
 * ```ts
 * const { url, addresses } = await resolveSafeUrl("https://example.com/feed")
 * ```
 */
export async function resolveSafeUrl(
  input: string | URL,
  policy: UrlPolicy = {},
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  const checked = pickOptions(policy)
  const url = checkUrl(input, checked, defaultDependencies.isBlockedAddress)
  const addresses = await resolveHost(
    normalizeAddress(url.hostname),
    checked.label ?? DEFAULT_LABEL,
    defaultDependencies,
  )

  return { url, addresses }
}
