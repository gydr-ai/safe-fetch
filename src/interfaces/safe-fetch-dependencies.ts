import type { KeepAlivePool } from "../fetch/keep-alive-pool.js"
import type { LookupResult } from "./safe-fetch-config.js"
import type { SafeFetchHooks } from "./safe-fetch-hooks.js"
import type { SafeFetchOptions } from "./safe-fetch-options.js"

/**
 * Everything one `safeFetch` instance runs with, validated and copied from
 * its configuration when the instance is created.
 *
 * @internal
 */
export interface SafeFetchDependencies {
  /** Resolve a hostname to every address it has. */
  lookup: (hostname: string) => Promise<readonly LookupResult[]>
  /** Return `true` for an address that must not be dialled. */
  isBlockedAddress: (address: string) => boolean
  /** Return `true` for a hostname the instance's hostname rules refuse. */
  isRefusedHostname: ((hostname: string) => boolean) | undefined
  /** Instance defaults for the per-call options. */
  defaults: SafeFetchOptions
  /** Default request headers, or `undefined` for none. */
  headers: Headers | undefined
  /** Header names dropped on a cross-origin redirect (a superset of the built-in set). */
  crossOriginStripped: ReadonlySet<string>
  /** The integrator's hooks. */
  hooks: SafeFetchHooks
  /** The instance's connection pool, or `undefined` for a new connection per request. */
  pool: (() => KeepAlivePool) | undefined
}
