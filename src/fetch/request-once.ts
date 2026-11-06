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
import { PIN_KEY_OPTION } from "./keep-alive-pool.js"
import { pinnedLookup } from "./pinned-lookup.js"

/**
 * Methods sent again when a REUSED socket was closed under them. Safe methods
 * only: a server may have acted on a PUT or DELETE before it closed.
 */
const RETRY_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"])

/** The transport errors of a pooled socket the server had already closed. */
const STALE_SOCKET_CODES: ReadonlySet<string> = new Set(["ECONNRESET", "EPIPE"])

/**
 * Whether an error is a stale pooled socket: a reset or broken pipe.
 *
 * @param error - the request error.
 * @returns `true` for `ECONNRESET` or `EPIPE`.
 */
function isStaleSocketError(error: Error): boolean {
  const code: unknown = Reflect.get(error, "code")

  return typeof code === "string" && STALE_SOCKET_CODES.has(code)
}

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

/**
 * Copy Node's parsed response headers into a `Headers` object, keeping
 * every value of a repeated header.
 *
 * @param incoming - the response from `http.request`.
 * @returns the headers.
 */
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
 * The vetted addresses as one pool-key part, independent of their order.
 *
 * @param addresses - the addresses this request may connect to.
 * @returns a stable key.
 */
function pinKeyOf(addresses: HopContext["addresses"]): string {
  return addresses
    .map((entry) => `${entry.family}/${entry.address}`)
    .sort()
    .join(",")
}

/**
 * Send one request, without following redirects, over a connection pinned to
 * the vetted addresses.
 *
 * Guarantees, in order: only the instance's own pool is ever reused (none
 * without `keepAlive`), and only a socket dialled for exactly
 * `context.addresses`; a new socket can only dial `context.addresses`; TLS
 * verifies the original hostname; a status outside 200-599 is refused (a
 * `Response` cannot represent it); a body is refused if its encoding cannot
 * be decoded or its declared length is over the cap; and every abort (caller
 * or deadline) destroys the request and response at once.
 *
 * @param hop - the request to send.
 * @param context - the vetted addresses, signal and limits.
 * @param fresh - send on a new connection even when the instance pools.
 * @returns the response, with a size-capped, decoded body stream.
 * @throws {SafeFetchError} on a network, status, encoding or size failure.
 * @throws {Error} the abort reason when `context.signal` fires.
 * @internal
 */
export function requestOnce(
  hop: HopRequest,
  context: HopContext,
  fresh = false,
): Promise<Response> {
  const { url } = hop
  const isHttps = url.protocol === "https:"
  const transport = isHttps ? https : http
  const pooled = context.pool !== undefined && !fresh
  const agent =
    context.pool === undefined || fresh
      ? false
      : isHttps
        ? context.pool.https
        : context.pool.http
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

    let abortedWith: Error | undefined

    const onAbort = (): void => {
      const reason = context.abortReason()

      abortedWith = reason

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
        // Never Node's global agent: a socket opened by other code in the
        // process could point anywhere. Either a new connection, or the
        // instance's own pool, whose sockets all dialled a vetted address.
        agent,
        lookup: pinnedLookup(host, context.addresses),
        // Keys the instance's pool by the vetted addresses (see the pool).
        ...(pooled ? { [PIN_KEY_OPTION]: pinKeyOf(context.addresses) } : {}),
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
          signal.removeEventListener("abort", onAbort)
          settled = true

          if (!pooled) {
            incoming.destroy()
            settle(() => new Response(null, init))

            return
          }

          // Nothing to read: answered once the (empty) message has ended, so
          // its socket is already back in the pool for the next request.
          incoming.once("end", () => {
            settle(() => new Response(null, init))
          })
          incoming.resume()

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
              bodyStream(
                incoming,
                decoders,
                context.maxResponseBytes,
                () => {
                  signal.removeEventListener("abort", onAbort)
                },
                (error) => error === abortedWith,
              ),
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

    // Bytes the socket had read before this request: a stale socket closes
    // without answering, so none arrive before the error.
    let bytesBefore = 0

    if (pooled) {
      request.on("socket", (socket) => {
        bytesBefore = socket.bytesRead
      })
      // Pooled sockets carry the pool's idle timer. Node only acts on it for
      // a FREE socket, but clear it anyway: the deadline alone bounds a
      // request in use.
      request.on("socket", (socket) => {
        socket.setTimeout(0)
      })
    }

    // Node hands a 101 to `upgrade` listeners and never to the response
    // callback; unhandled, the request would wait for the deadline.
    request.on("upgrade", (_incoming, socket) => {
      socket.destroy()

      if (settled) return

      signal.removeEventListener("abort", onAbort)
      settled = true
      reject(
        new SafeFetchError(
          SafeFetchErrorCode.NETWORK_ERROR,
          "Response status 101 is not valid",
        ),
      )
    })

    request.on("error", (error) => {
      if (
        !settled &&
        pooled &&
        request.reusedSocket &&
        RETRY_METHODS.has(hop.method) &&
        isStaleSocketError(error) &&
        request.socket?.bytesRead === bytesBefore
      ) {
        // The server had closed an idle pooled socket as this request was
        // written to it (reset, nothing answered): send it once more, on a
        // new connection.
        signal.removeEventListener("abort", onAbort)
        settled = true
        resolve(requestOnce(hop, context, true))

        return
      }

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
