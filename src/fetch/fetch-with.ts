import {
  ACCEPT_ENCODING,
  DEFAULT_LABEL,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
} from "../constants/defaults.js"
import { REDIRECT_STATUSES, TRANSPORT_HEADERS } from "../constants/http.js"
import {
  SafeFetchError,
  SafeFetchErrorCode,
} from "../errors/safe-fetch-error.js"
import { encodeBody } from "../helpers/encode-body.js"
import {
  runDecisionHook,
  frozenAddresses,
  runObserverHook,
} from "../helpers/hooks.js"
import { normalizeAddress } from "../helpers/ip.js"
import { mergeHeaders } from "../helpers/merge-headers.js"
import { normalizeMethod } from "../helpers/normalize-method.js"
import { mergeOptions } from "../helpers/options.js"
import { ownProperty } from "../helpers/own-property.js"
import { raceAbort } from "../helpers/race-abort.js"
import { nextHop } from "../helpers/redirect-hop.js"
import { withResponseUrl } from "../helpers/response-url.js"
import type { HopRequest } from "../interfaces/hop.js"
import type { SafeFetchDependencies } from "../interfaces/safe-fetch-dependencies.js"
import type { SafeFetchOptions } from "../interfaces/safe-fetch-options.js"
import { checkUrl } from "../url/check-url.js"
import { requestOnce } from "./request-once.js"
import { resolveHost } from "./resolve-host.js"

/**
 * Validate `init.redirect`. Like `fetch`, an unknown mode is a `TypeError`;
 * it is never read as `"follow"`.
 *
 * @param mode - the caller's own `init.redirect`, or `undefined`.
 * @returns the redirect mode; `"error"` when unset.
 * @throws {TypeError} for any other value.
 */
function redirectModeOf(mode: unknown): NonNullable<RequestInit["redirect"]> {
  switch (mode) {
    case undefined:
      return "error"
    case "error":
    case "follow":
    case "manual":
      return mode
    default:
      throw new TypeError('init.redirect must be "error", "follow" or "manual"')
  }
}

/**
 * Build the `safeFetch` function for one set of dependencies.
 *
 * Each call validates the URL, then loops over redirect hops: resolve and
 * vet the host (racing the deadline), send one pinned request, and either
 * return the response or re-validate the redirect target as a brand-new
 * URL before following it. Hooks run only after the built-in checks they
 * follow, and only see frozen copies.
 *
 * @param dependencies - the resolver, policies, defaults and hooks.
 * @returns a `safeFetch` function.
 * @internal
 */
export function fetchWith(dependencies: SafeFetchDependencies) {
  return async function safeFetch(
    input: string | URL,
    init: RequestInit = {},
    callOptions: SafeFetchOptions = {},
  ): Promise<Response> {
    const { hooks } = dependencies
    const options = mergeOptions(dependencies.defaults, callOptions)
    const callerSignal = ownProperty(init, "signal") ?? undefined
    const label = options.label ?? DEFAULT_LABEL
    const redirectMode = redirectModeOf(ownProperty(init, "redirect"))
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
    const deadline = AbortSignal.timeout(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    const signal =
      callerSignal === undefined
        ? deadline
        : AbortSignal.any([callerSignal, deadline])
    const abortReason = (): Error => {
      if (callerSignal?.aborted === true) {
        const reason: unknown = callerSignal.reason

        // Like fetch, rethrow the caller's own reason; a non-Error reason is
        // wrapped so that every rejection is an Error.
        return reason instanceof Error
          ? reason
          : new Error(String(reason), { cause: reason })
      }

      return new SafeFetchError(
        SafeFetchErrorCode.TIMEOUT,
        `${label} did not complete within ${String(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)} ms`,
      )
    }

    // Validate the URL before reading the body: a refused URL never costs a
    // read of the request body.
    const firstUrl = checkUrl(
      input,
      options,
      dependencies.isBlockedAddress,
      dependencies.isRefusedHostname,
    )
    const encoded = await encodeBody(ownProperty(init, "body"))
    const headers = mergeHeaders(
      dependencies.headers,
      ownProperty(init, "headers"),
    )

    for (const name of TRANSPORT_HEADERS) headers.delete(name)

    if (encoded?.contentType !== undefined && !headers.has("content-type")) {
      headers.set("content-type", encoded.contentType)
    }

    const decompress = options.decompress !== false

    if (decompress && !headers.has("accept-encoding")) {
      headers.set("accept-encoding", ACCEPT_ENCODING)
    }

    let hop: HopRequest = {
      url: firstUrl,
      method: normalizeMethod(ownProperty(init, "method")),
      headers,
      body: encoded?.bytes,
    }

    for (let redirects = 0; ; redirects += 1) {
      const host = normalizeAddress(hop.url.hostname)
      const addresses = await raceAbort(
        resolveHost(host, label, dependencies),
        signal,
        abortReason,
      )
      runObserverHook(
        "onRequest",
        hooks.onRequest,
        Object.freeze({
          url: new URL(hop.url.href),
          method: hop.method,
          addresses: frozenAddresses(addresses),
        }),
      )

      const response = await requestOnce(hop, {
        addresses,
        signal,
        abortReason,
        maxResponseBytes:
          options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
        decompress,
      })

      try {
        runObserverHook(
          "onResponse",
          hooks.onResponse,
          Object.freeze({
            url: new URL(hop.url.href),
            status: response.status,
          }),
        )
      } catch (error) {
        await response.body?.cancel()
        throw error
      }

      const location = response.headers.get("location")

      if (!REDIRECT_STATUSES.has(response.status) || location === null) {
        return withResponseUrl(response, hop.url, redirects > 0)
      }

      switch (redirectMode) {
        case "manual":
          return withResponseUrl(response, hop.url, redirects > 0)
        case "error":
          await response.body?.cancel()
          throw new SafeFetchError(
            SafeFetchErrorCode.REDIRECT_NOT_ALLOWED,
            `${label} returned a redirect`,
          )
        case "follow":
          await response.body?.cancel()
      }

      if (redirects >= maxRedirects) {
        throw new SafeFetchError(
          SafeFetchErrorCode.TOO_MANY_REDIRECTS,
          `${label} exceeded ${maxRedirects} redirects`,
        )
      }

      let target: URL

      try {
        target = new URL(location, hop.url)
      } catch {
        throw new SafeFetchError(
          SafeFetchErrorCode.NETWORK_ERROR,
          `${label} returned an invalid redirect location`,
        )
      }

      // Every hop is a fresh SSRF attempt: full policy, fresh DNS, fresh pin.
      const checked = checkUrl(
        target,
        options,
        dependencies.isBlockedAddress,
        dependencies.isRefusedHostname,
      )
      const followed = runDecisionHook(
        "onRedirect",
        hooks.onRedirect,
        Object.freeze({
          from: new URL(hop.url.href),
          to: new URL(checked.href),
          status: response.status,
        }),
      )

      if (!followed) {
        throw new SafeFetchError(
          SafeFetchErrorCode.REDIRECT_NOT_ALLOWED,
          `${label} redirect was refused`,
        )
      }

      hop = nextHop(
        hop,
        response.status,
        checked,
        dependencies.crossOriginStripped,
      )
    }
  }
}
