import type { ResolvedAddress } from "./resolved-address.js"
import type { KeepAlivePool } from "../fetch/keep-alive-pool.js"

/**
 * One request in a redirect chain.
 *
 * @internal
 */
export interface HopRequest {
  /** The URL, already accepted by the URL policy. */
  url: URL
  /** The normalised request method. */
  method: string
  /** The request headers, with transport headers already removed. */
  headers: Headers
  /** The request body, or `undefined` for none. */
  body: Buffer | undefined
}

/**
 * Everything a single hop needs beyond the request itself.
 *
 * @internal
 */
export interface HopContext {
  /** The vetted addresses the connection may be pinned to. */
  addresses: readonly ResolvedAddress[]
  /** Fires on the caller's abort or the overall deadline. */
  signal: AbortSignal
  /** The error to reject with once `signal` has fired. */
  abortReason: () => Error
  /** Largest decoded body accepted, in bytes. */
  maxResponseBytes: number
  /** Whether to decode `Content-Encoding`. */
  decompress: boolean
  /** The instance's connection pool, or `undefined` for a new connection per request. */
  pool: KeepAlivePool | undefined
}
