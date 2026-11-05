/**
 * Why a URL, or an address its hostname resolved to, was refused. The values
 * are stable strings: branch on them, never on the error message.
 *
 * @example
 * ```ts
 * try {
 *   assertSafeUrl(input)
 * } catch (error) {
 *   if (
 *     error instanceof UnsafeUrlError &&
 *     error.reason === UnsafeUrlReason.BLOCKED_ADDRESS
 *   ) {
 *     // the URL points at a private or reserved address
 *   }
 * }
 * ```
 */
export const UnsafeUrlReason = Object.freeze({
  /** The URL is longer than the policy's `maxLength`. */
  URL_TOO_LONG: "url_too_long",
  /** The input cannot be parsed as an absolute URL. */
  MALFORMED_URL: "malformed_url",
  /** The scheme is not `https:` (or `http:` when `allowHttp` is set). */
  PROTOCOL_NOT_ALLOWED: "protocol_not_allowed",
  /** The URL carries a username or password. */
  CREDENTIALS_IN_URL: "credentials_in_url",
  /** The port is not in the policy's `allowedPorts`. */
  PORT_NOT_ALLOWED: "port_not_allowed",
  /** The host, or an address it resolved to, is private or reserved. */
  BLOCKED_ADDRESS: "blocked_address",
} as const)

/** One of the {@link UnsafeUrlReason} values. */
export type UnsafeUrlReason =
  (typeof UnsafeUrlReason)[keyof typeof UnsafeUrlReason]

/**
 * A URL refused by `assertSafeUrl`, `resolveSafeUrl` or `safeFetch` because
 * it, or an address it resolved to, breaks the URL or address policy.
 *
 * @example
 * ```ts
 * try {
 *   assertSafeUrl("https://169.254.169.254/")
 * } catch (error) {
 *   if (error instanceof UnsafeUrlError) console.log(error.reason)
 *   // "blocked_address"
 * }
 * ```
 */
export class UnsafeUrlError extends Error {
  /** Always `"UnsafeUrlError"`. */
  override readonly name = "UnsafeUrlError"
  /** The stable reason the URL was refused. */
  readonly reason: UnsafeUrlReason

  /**
   * Create the error.
   *
   * @param reason - why the URL was refused.
   * @param message - a human-readable description; never parse it.
   */
  constructor(reason: UnsafeUrlReason, message: string) {
    super(message)
    this.reason = reason
  }
}
