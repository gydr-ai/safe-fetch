import type { UrlPolicy } from "./url-policy.js"

/** Per-request options for `safeFetch`, on top of the {@link UrlPolicy}. */
export interface SafeFetchOptions extends UrlPolicy {
  /**
   * Total deadline in milliseconds for DNS, connect, every redirect hop and
   * reading the whole body. Applies alongside `init.signal`; whichever fires
   * first wins. Default: `15000`.
   */
  timeoutMs?: number
  /**
   * Largest response body accepted, in bytes AFTER decompression, so a
   * compression bomb is stopped too. Default: `10485760` (10 MiB).
   */
  maxResponseBytes?: number
  /** Redirect hops followed when `init.redirect` is `"follow"`. Default: `5`. */
  maxRedirects?: number
  /** Decode gzip, deflate and brotli responses. Default: `true`. */
  decompress?: boolean
}
