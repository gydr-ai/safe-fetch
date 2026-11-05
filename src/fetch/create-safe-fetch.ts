import type { SafeFetchConfig } from "../interfaces/safe-fetch-config.js"
import { defaultDependencies, dependenciesFor } from "./dependencies.js"
import { fetchWith } from "./fetch-with.js"

/**
 * Build a `safeFetch` with your own defaults, resolver, address ranges,
 * hostname rules, headers and hooks.
 *
 * Every extension point can only tighten or observe a request; none can
 * skip the address policy, the socket pin, per-hop re-validation,
 * cross-origin credential stripping, the deadline, the size cap or the
 * status and encoding guards. The one deliberate exception is
 * `allowedRanges`, which permits the ranges it lists.
 *
 * The configuration is validated and copied here, so a bad value fails at
 * start-up, and changing the object later has no effect. The plain
 * {@link safeFetch} export is `createSafeFetch()`.
 *
 * @param config - instance defaults, policies, headers and hooks.
 * @returns a function with the same signature as {@link safeFetch}.
 * @throws {TypeError} when a range, hostname pattern, header or hook is invalid.
 * @example
 * ```ts
 * const fetchPartner = createSafeFetch({
 *   allowedHostnames: ["*.partner.example"],
 *   headers: { "user-agent": "my-app/1.0" },
 *   stripHeadersOnCrossOrigin: ["x-api-key"],
 *   timeoutMs: 5000,
 *   onResponse: ({ url, status }) => {
 *     console.log(status, url.host)
 *   },
 * })
 * const response = await fetchPartner("https://api.partner.example/v1/items")
 * ```
 */
export function createSafeFetch(
  config: SafeFetchConfig = {},
): typeof safeFetch {
  return fetchWith(dependenciesFor(config))
}

/**
 * `fetch` for URLs you do not control.
 *
 * Validates the URL, resolves the hostname, refuses the request if ANY
 * resolved address is private or reserved, and then connects to exactly the
 * address it checked, so a DNS-rebinding answer between the check and the
 * connection cannot redirect it. Every redirect hop gets the same treatment,
 * credentials are dropped on cross-origin redirects, and the whole exchange
 * runs under one deadline and one decoded-size cap.
 *
 * Returns a standard `Response`. Differences from `fetch`:
 * - `init.redirect` defaults to `"error"`; pass `"follow"` to opt in.
 * - Request bodies must be a string, `URLSearchParams`, `ArrayBuffer`,
 *   typed array or `Blob` (no streams or `FormData`).
 * - No connection pooling, no proxy and no cookies.
 *
 * @param input - the URL to fetch.
 * @param init - standard `fetch` options.
 * @param options - the URL policy, deadline and limits for this request.
 * @returns the response.
 * @throws {UnsafeUrlError} the URL, or an address it resolved to, is refused.
 * @throws {SafeFetchError} DNS, timeout, redirect, size, network or hook
 *   failure.
 * @throws {Error} the caller's `init.signal.reason` when the caller aborts
 *   (wrapped in an `Error` if it is not one).
 * @example
 * ```ts
 * const response = await safeFetch(userSuppliedUrl, {
 *   method: "POST",
 *   headers: { "content-type": "application/json" },
 *   body: JSON.stringify(event),
 * })
 * ```
 */
export const safeFetch = fetchWith(defaultDependencies)
