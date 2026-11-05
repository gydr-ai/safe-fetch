import { BODY_HEADERS, CROSS_ORIGIN_STRIPPED } from "../constants/http.js"
import type { HopRequest } from "../interfaces/hop.js"

/**
 * Whether a redirect turns the request into a body-less `GET` (Fetch
 * Standard "HTTP-redirect fetch", step 12): a 303 for anything but
 * `GET`/`HEAD`, and a 301 or 302 for `POST`.
 *
 * @param status - the redirect status.
 * @param method - the method of the request being redirected.
 * @returns `true` when the next hop must be a `GET` without a body.
 */
function downgradesToGet(status: number, method: string): boolean {
  switch (status) {
    case 303:
      return method !== "GET" && method !== "HEAD"
    case 301:
    case 302:
      return method === "POST"
    default:
      return false
  }
}

/**
 * Build the next hop of a redirect chain with the Fetch Standard rewrites:
 * the method downgrade (dropping the body and its headers) and, on a
 * cross-origin hop, removal of `Authorization`, `Cookie`,
 * `Proxy-Authorization` and any configured extra names, so credentials
 * never leak to another origin.
 *
 * The target URL must already have passed the URL policy.
 *
 * @param previous - the request that was redirected.
 * @param status - the redirect status.
 * @param location - the validated redirect target.
 * @param crossOriginStripped - header names dropped on a cross-origin hop;
 *   always a superset of the built-in set.
 * @returns the request to send next.
 * @internal
 */
export function nextHop(
  previous: HopRequest,
  status: number,
  location: URL,
  crossOriginStripped: ReadonlySet<string> = CROSS_ORIGIN_STRIPPED,
): HopRequest {
  const headers = new Headers(previous.headers)
  let { method, body } = previous

  if (downgradesToGet(status, method)) {
    method = "GET"
    body = undefined

    for (const name of BODY_HEADERS) headers.delete(name)
  }

  if (previous.url.origin !== location.origin) {
    for (const name of crossOriginStripped) headers.delete(name)
  }

  return { url: location, method, headers, body }
}
