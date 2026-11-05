/**
 * Why `safeFetch` failed after the URL itself was accepted. The values are
 * stable strings: branch on them, never on the error message. The object
 * is frozen.
 *
 * @example
 * ```ts
 * try {
 *   await safeFetch(url)
 * } catch (error) {
 *   if (
 *     error instanceof SafeFetchError &&
 *     error.code === SafeFetchErrorCode.TIMEOUT
 *   ) {
 *     // retry later
 *   }
 * }
 * ```
 */
export const SafeFetchErrorCode = Object.freeze({
  /** The hostname did not resolve, or resolved to no address. */
  DNS_FAILURE: "dns_failure",
  /** The `timeoutMs` deadline passed. */
  TIMEOUT: "timeout",
  /** The server redirected and `init.redirect` is `"error"` (the default). */
  REDIRECT_NOT_ALLOWED: "redirect_not_allowed",
  /** More than `maxRedirects` redirects were followed. */
  TOO_MANY_REDIRECTS: "too_many_redirects",
  /** The decoded body is larger than `maxResponseBytes`. */
  RESPONSE_TOO_LARGE: "response_too_large",
  /** The request body is a stream, `FormData` or another unsupported type. */
  UNSUPPORTED_BODY: "unsupported_body",
  /** The method is not a valid HTTP token, or is `CONNECT`, `TRACE` or `TRACK`. */
  UNSUPPORTED_METHOD: "unsupported_method",
  /** The response uses a content encoding that cannot be safely decoded. */
  UNSUPPORTED_ENCODING: "unsupported_encoding",
  /** The connection, the response or its body failed. */
  NETWORK_ERROR: "network_error",
  /** A hook passed to `createSafeFetch` threw or returned an invalid value. */
  HOOK_FAILED: "hook_failed",
} as const)

/** One of the {@link SafeFetchErrorCode} values. */
export type SafeFetchErrorCode =
  (typeof SafeFetchErrorCode)[keyof typeof SafeFetchErrorCode]

/**
 * A request `safeFetch` could not complete safely: DNS, deadline, redirect,
 * size, body, method, encoding, network or hook failure.
 *
 * @example
 * ```ts
 * try {
 *   await safeFetch(url, {}, { maxResponseBytes: 1024 })
 * } catch (error) {
 *   if (error instanceof SafeFetchError) console.log(error.code)
 *   // e.g. "response_too_large"
 * }
 * ```
 */
export class SafeFetchError extends Error {
  /** Always `"SafeFetchError"`. */
  override readonly name = "SafeFetchError"
  /** The stable reason the request failed. */
  readonly code: SafeFetchErrorCode

  /**
   * Create the error.
   *
   * @param code - why the request failed.
   * @param message - a human-readable description; never parse it.
   * @param options - standard `Error` options; `cause` holds the underlying error.
   * @param options.cause - the underlying error, if any.
   */
  constructor(
    code: SafeFetchErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.code = code
  }
}
