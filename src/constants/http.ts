/**
 * Response statuses that never carry a body (Fetch Standard "null body
 * status").
 *
 * @internal
 */
export const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([
  101, 204, 205, 304,
])

/**
 * Response statuses treated as redirects (Fetch Standard "redirect status").
 *
 * @internal
 */
export const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
])

/**
 * Methods refused outright: `CONNECT` opens a tunnel, and `TRACE` / `TRACK`
 * reflect request headers (including credentials) back to the caller.
 *
 * @internal
 */
export const FORBIDDEN_METHODS: ReadonlySet<string> = new Set([
  "CONNECT",
  "TRACE",
  "TRACK",
])

/**
 * Methods upper-cased whatever case the caller used, as `fetch` does (Fetch
 * Standard "normalize a method"). Any other method is sent as written.
 *
 * @internal
 */
export const NORMALIZED_METHODS: ReadonlySet<string> = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
])

/**
 * RFC 9110 § 5.6.2 `token`: the only characters an HTTP method or header
 * name may contain. Anything else could split the request line or a header.
 *
 * @internal
 */
export const HTTP_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/**
 * Headers the transport owns; a caller-supplied value is dropped so it cannot
 * re-target the request (`host`) or desynchronise the framing.
 *
 * @internal
 */
export const TRANSPORT_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

/**
 * Credentials that must never follow a redirect to another origin.
 *
 * @internal
 */
export const CROSS_ORIGIN_STRIPPED: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
])

/**
 * Headers describing a request body; dropped when a redirect drops the body.
 *
 * @internal
 */
export const BODY_HEADERS: ReadonlySet<string> = new Set([
  "content-encoding",
  "content-language",
  "content-location",
  "content-type",
])
