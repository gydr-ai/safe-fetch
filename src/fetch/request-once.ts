import * as http from "node:http"
import * as https from "node:https"

import { NULL_BODY_STATUSES } from "../constants/http.js"
import {
  SafeFetchError,
  SafeFetchErrorCode,
} from "../errors/safe-fetch-error.js"
import { decodersFor } from "../helpers/content-decoders.js"
import { ipVersion, normalizeAddress } from "../helpers/ip.js"
import { portOf } from "../helpers/port-of.js"
import type { HopContext, HopRequest } from "../interfaces/hop.js"
import { bodyStream } from "./body-stream.js"
import { pinnedLookup } from "./pinned-lookup.js"

/**
 * Copy Node's parsed response headers into a `Headers` object, keeping
 * every value of a repeated header.
 *
 * @param incoming - the response from `http.request`.
 * @returns the headers.
 */
/**
 * A reason phrase `Response` accepts (RFC 9110: HTAB, SP, VCHAR, obs-text),
 * or `""`. Node's parser accepts bytes such as DEL that `Response` rejects,
 * and that rejection must never escape the response callback.
 *
 * @param message - The raw reason phrase Node parsed, if any.
 * @returns The phrase unchanged when valid, otherwise an empty string.
 */
function safeStatusText(message: string | undefined): string {
  if (message === undefined) return ""

  for (const char of message) {
    const code = char.charCodeAt(0)
    const valid =
      code === 0x09 ||
      code === 0x20 ||
      (code >= 0x21 && code <= 0x7e) ||
      (code >= 0x80 && code <= 0xff)

    if (!valid) return ""
  }

  return message
}

function responseHeadersOf(incoming: http.IncomingMessage): Headers {
  const headers = new Headers()

  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry)
    } else if (value !== undefined) {
      headers.set(key, value)
    }
  }

  return headers
}

/**
 * Send one request, without following redirects, over a fresh connection
 * pinned to the vetted addresses.
 *
 * Guarantees, in order: no pooled socket is ever reused; the socket can only
 * dial `context.addresses`; TLS verifies the original hostname; a status
 * outside 200-599 is refused (a `Response` cannot represent it); a body is
 * refused if its encoding cannot be decoded or its declared length is over
 * the cap; and every abort (caller or deadline) destroys the request and
 * response at once.
 *
 * @param hop - the request to send.
 * @param context - the vetted addresses, signal and limits.
 * @returns the response, with a size-capped, decoded body stream.
 * @throws {SafeFetchError} on a network, status, encoding or size failure.
 * @throws {Error} the abort reason when `context.signal` fires.
 * @internal
 */
export function requestOnce(
  hop: HopRequest,
  context: HopContext,
): Promise<Response> {
  const { url } = hop
  const isHttps = url.protocol === "https:"
  const transport = isHttps ? https : http
  const host = normalizeAddress(url.hostname)
  const headers: Record<string, string> = {}

  hop.headers.forEach((value, key) => {
    headers[key] = value
  })

  if (hop.body !== undefined) {
    headers["content-length"] = String(hop.body.byteLength)
  }

  return new Promise<Response>((resolve, reject) => {
    const { signal } = context
    let settled = false
    let response: http.IncomingMessage | undefined

    const onAbort = (): void => {
      const reason = context.abortReason()

      request.destroy(reason)
      response?.destroy(reason)

      if (!settled) {
        settled = true
        reject(reason)
      }
    }

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: host,
        port: portOf(url),
        path: `${url.pathname}${url.search}`,
        method: hop.method,
        headers,
        // A fresh agent per request: a pooled socket opened by other code in
        // the process could point anywhere, and must never be reused here.
        agent: false,
        lookup: pinnedLookup(host, context.addresses),
        ...(isHttps && ipVersion(host) === 0 ? { servername: host } : {}),
      },
      (incoming) => {
        response = incoming

        const fail = (error: SafeFetchError): void => {
          incoming.destroy()
          signal.removeEventListener("abort", onAbort)
          settled = true
          reject(error)
        }

        // Building a Response must never throw out of this callback: an
        // exception here is uncaught and would end the process.
        const settle = (build: () => Response): void => {
          try {
            resolve(build())
          } catch (error) {
            incoming.destroy()
            signal.removeEventListener("abort", onAbort)
            reject(
              new SafeFetchError(
                SafeFetchErrorCode.NETWORK_ERROR,
                "Response could not be read",
                { cause: error },
              ),
            )
          }
        }

        const status = incoming.statusCode ?? 0

        // Node accepts 100-999; a Response only 200-599 (1xx never get here).
        if (status < 200 || status > 599) {
          fail(
            new SafeFetchError(
              SafeFetchErrorCode.NETWORK_ERROR,
              `Response status ${status} is not valid`,
            ),
          )

          return
        }

        const responseHeaders = responseHeadersOf(incoming)
        const init = {
          status,
          statusText: safeStatusText(incoming.statusMessage),
          headers: responseHeaders,
        }
        const hasBody = !NULL_BODY_STATUSES.has(status) && hop.method !== "HEAD"

        if (!hasBody) {
          incoming.destroy()
          signal.removeEventListener("abort", onAbort)
          settled = true
          settle(() => new Response(null, init))

          return
        }

        const decoders = context.decompress
          ? decodersFor(responseHeaders.get("content-encoding"))
          : []

        if (decoders === null) {
          fail(
            new SafeFetchError(
              SafeFetchErrorCode.UNSUPPORTED_ENCODING,
              "Response uses a content encoding that cannot be decoded",
            ),
          )

          return
        }

        if (decoders.length === 0) {
          const declared = Number(responseHeaders.get("content-length"))

          if (
            Number.isFinite(declared) &&
            declared > context.maxResponseBytes
          ) {
            fail(
              new SafeFetchError(
                SafeFetchErrorCode.RESPONSE_TOO_LARGE,
                `Response body exceeded ${context.maxResponseBytes} bytes`,
              ),
            )

            return
          }
        } else {
          // The decoded body has a different length and no encoding.
          responseHeaders.delete("content-encoding")
          responseHeaders.delete("content-length")
        }

        settled = true
        settle(
          () =>
            new Response(
              bodyStream(incoming, decoders, context.maxResponseBytes, () => {
                signal.removeEventListener("abort", onAbort)
              }),
              init,
            ),
        )
      },
    )

    if (signal.aborted) {
      onAbort()

      return
    }

    signal.addEventListener("abort", onAbort, { once: true })

    request.on("error", (error) => {
      if (settled) {
        // The body may still be streaming: end it, and keep the deadline
        // listener until the body stream's own teardown removes it.
        response?.destroy(error)

        return
      }

      signal.removeEventListener("abort", onAbort)

      settled = true
      reject(
        error instanceof SafeFetchError
          ? error
          : new SafeFetchError(
              SafeFetchErrorCode.NETWORK_ERROR,
              "Request failed",
              { cause: error },
            ),
      )
    })

    request.end(hop.body)
  })
}
