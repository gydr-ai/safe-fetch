import {
  FORBIDDEN_METHODS,
  HTTP_TOKEN,
  NORMALIZED_METHODS,
} from "../constants/http.js"
import {
  SafeFetchError,
  SafeFetchErrorCode,
} from "../errors/safe-fetch-error.js"

/**
 * Validate and normalise a request method the way `fetch` does.
 *
 * The method must be an RFC 9110 token, so it cannot inject into the request
 * line; `CONNECT`, `TRACE` and `TRACK` are refused in any case; the six
 * standard methods are upper-cased and any other method is kept as written.
 *
 * @param method - the caller's `init.method`; `undefined` means `GET`.
 * @returns the method to send.
 * @throws {SafeFetchError} `UNSUPPORTED_METHOD` for an invalid or forbidden method.
 * @internal
 */
export function normalizeMethod(method: string | undefined): string {
  const value = method ?? "GET"

  if (!HTTP_TOKEN.test(value)) {
    throw new SafeFetchError(
      SafeFetchErrorCode.UNSUPPORTED_METHOD,
      "Request method is not a valid HTTP token",
    )
  }

  const upper = value.toUpperCase()

  if (FORBIDDEN_METHODS.has(upper)) {
    throw new SafeFetchError(
      SafeFetchErrorCode.UNSUPPORTED_METHOD,
      `${upper} requests are not allowed`,
    )
  }

  return NORMALIZED_METHODS.has(upper) ? upper : value
}
