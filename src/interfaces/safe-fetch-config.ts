import type { AddressPolicyOptions } from "./address-policy-options.js"
import type { HostnamePolicyOptions } from "./hostname-policy-options.js"
import type { SafeFetchHooks } from "./safe-fetch-hooks.js"
import type { SafeFetchOptions } from "./safe-fetch-options.js"

/** A resolved address, as returned by a custom `lookup`. */
export interface LookupResult {
  /** The IP address. */
  address: string
  /** The IP family: `6` for IPv6, anything else is treated as IPv4. */
  family: number
}

/**
 * Configuration for `createSafeFetch`.
 *
 * Every {@link SafeFetchOptions} field set here is the instance default; the
 * same field passed to a single call wins. Everything else here can only
 * tighten or observe a request, except `allowedRanges`, which deliberately
 * permits listed ranges.
 */
export interface SafeFetchConfig
  extends
    AddressPolicyOptions,
    HostnamePolicyOptions,
    SafeFetchOptions,
    SafeFetchHooks {
  /**
   * Resolve a hostname to every address it has. Use it for DNS-over-HTTPS, a
   * caching resolver or tests. Every address it returns is still checked
   * against the address policy, and the connection is still pinned to one of
   * them. Default: the operating system resolver.
   */
  lookup?: (hostname: string) => Promise<readonly LookupResult[]>
  /**
   * Headers sent with every request (e.g. `User-Agent`). A header passed to
   * a single call replaces the default of the same name. Transport headers
   * (`Host`, `Connection`, ...) are still dropped, and credentials are still
   * stripped on a cross-origin redirect. Default: none.
   */
  headers?: NonNullable<RequestInit["headers"]>
  /**
   * Extra header names dropped on a cross-origin redirect, e.g.
   * `["x-api-key"]`. Added to the built-in `Authorization`, `Cookie` and
   * `Proxy-Authorization`, which are always dropped. Default: none.
   */
  stripHeadersOnCrossOrigin?: readonly string[]
  /**
   * Reuse connections between requests of this instance. Each instance owns
   * its own pool (never Node's global agent), and a socket joins it only
   * after it connected, through the pinned lookup, to an address that passed
   * the address policy. Every request is still resolved and checked first,
   * and a socket is reused only for the same hostname, port and set of
   * checked addresses. An idle socket closes after 4 seconds, or sooner when
   * the server asks; a body that is not read to its end closes its socket.
   * A `GET`, `HEAD` or `OPTIONS` whose reused socket the server had just
   * closed, with nothing received, is sent once more on a new connection;
   * other methods never are. Default: `false` (a new connection per
   * request).
   */
  keepAlive?: boolean
}
