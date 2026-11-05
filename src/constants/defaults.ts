/**
 * Name used for the URL in error messages when the caller sets no `label`.
 *
 * @internal
 */
export const DEFAULT_LABEL = "URL"

/**
 * Longest URL accepted, in characters, when the caller sets no `maxLength`.
 *
 * @internal
 */
export const DEFAULT_MAX_LENGTH = 2048

/**
 * Total request deadline in milliseconds when the caller sets no `timeoutMs`.
 *
 * @internal
 */
export const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Largest decoded response body in bytes when the caller sets no
 * `maxResponseBytes` (10 MiB).
 *
 * @internal
 */
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024

/**
 * Redirect hops followed when the caller sets no `maxRedirects`.
 *
 * @internal
 */
export const DEFAULT_MAX_REDIRECTS = 5

/**
 * Decoding layers accepted in one `Content-Encoding` header. A deeper stack
 * has no legitimate use and multiplies decompression cost.
 *
 * @internal
 */
export const MAX_CONTENT_ENCODINGS = 2

/**
 * The `Accept-Encoding` value sent when decompression is on and the caller
 * set none: exactly the codings this package can decode.
 *
 * @internal
 */
export const ACCEPT_ENCODING = "gzip, deflate, br"
