import { promises as dnsPromises } from "node:dns"
import * as http from "node:http"
import * as https from "node:https"
import type { LookupFunction } from "node:net"
import { type Readable, Transform, type TransformCallback } from "node:stream"
import * as zlib from "node:zlib"

import {
  type AddressPolicyOptions,
  createAddressPolicy,
  ipVersion,
  normalizeAddress,
} from "./address.js"
import {
  checkUrl,
  UnsafeUrlError,
  UnsafeUrlReason,
  type UrlPolicy,
} from "./url.js"

/** Why `safeFetch` failed after the URL itself was accepted. */
export const SafeFetchErrorCode = {
  DNS_FAILURE: "dns_failure",
  TIMEOUT: "timeout",
  REDIRECT_NOT_ALLOWED: "redirect_not_allowed",
  TOO_MANY_REDIRECTS: "too_many_redirects",
  RESPONSE_TOO_LARGE: "response_too_large",
  UNSUPPORTED_BODY: "unsupported_body",
  UNSUPPORTED_METHOD: "unsupported_method",
  UNSUPPORTED_ENCODING: "unsupported_encoding",
  NETWORK_ERROR: "network_error",
} as const

export type SafeFetchErrorCode =
  (typeof SafeFetchErrorCode)[keyof typeof SafeFetchErrorCode]

/** A request `safeFetch` could not complete safely. */
export class SafeFetchError extends Error {
  override readonly name = "SafeFetchError"
  readonly code: SafeFetchErrorCode

  constructor(
    code: SafeFetchErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.code = code
  }
}

/** Options for {@link safeFetch}. */
export interface SafeFetchOptions extends UrlPolicy {
  /**
   * Total deadline in milliseconds for DNS, connect, every redirect hop and
   * reading the whole body. Applies alongside `init.signal`; whichever fires
   * first wins. Default 15 000.
   */
  timeoutMs?: number
  /**
   * Largest response body accepted, in bytes AFTER decompression, so a
   * compression bomb is stopped too. Default 10 MiB.
   */
  maxResponseBytes?: number
  /** Redirect hops followed when `init.redirect` is `"follow"`. Default 5. */
  maxRedirects?: number
  /** Decode gzip, deflate and brotli responses. Default `true`. */
  decompress?: boolean
}

/** An address a hostname resolved to and that passed the blocklist. */
export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

/** A resolved address, as returned by a custom `lookup`. */
export interface LookupResult {
  address: string
  family: number
}

/** Configuration for {@link createSafeFetch}. */
export interface SafeFetchConfig extends AddressPolicyOptions {
  /**
   * Resolve a hostname to every address it has. Defaults to the operating
   * system resolver. Use it for DNS-over-HTTPS, a caching resolver or tests.
   * Every address it returns is still checked against the address policy,
   * and the connection is still pinned to one of them.
   */
  lookup?: (hostname: string) => Promise<readonly LookupResult[]>
}

interface SafeFetchDependencies {
  lookup(hostname: string): Promise<readonly LookupResult[]>
  isBlockedAddress(address: string): boolean
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 5

const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304])
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
])
const FORBIDDEN_METHODS: ReadonlySet<string> = new Set([
  "CONNECT",
  "TRACE",
  "TRACK",
])
const NORMALIZED_METHODS: ReadonlySet<string> = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
])

/** RFC 9110 `token`: the only characters an HTTP method may contain. */
const METHOD_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** Decoding layers accepted in one `Content-Encoding` header. */
const MAX_CONTENT_ENCODINGS = 2

/** Headers the transport owns; a caller value is dropped. */
const TRANSPORT_HEADERS: ReadonlySet<string> = new Set([
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

/** Credentials that must never follow a redirect to another origin. */
const CROSS_ORIGIN_STRIPPED: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
])

/** Headers describing a request body; dropped when a redirect drops it. */
const BODY_HEADERS: ReadonlySet<string> = new Set([
  "content-encoding",
  "content-language",
  "content-location",
  "content-type",
])

const systemLookup = (hostname: string): Promise<readonly LookupResult[]> =>
  dnsPromises.lookup(hostname, { all: true, order: "verbatim" })

function dependenciesFor(config: SafeFetchConfig): SafeFetchDependencies {
  return {
    lookup: config.lookup ?? systemLookup,
    isBlockedAddress: createAddressPolicy(config),
  }
}

const defaultDependencies = dependenciesFor({})

/** Reject with the signal's reason as soon as it aborts. */
function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  reason: () => unknown,
): Promise<T> {
  if (signal.aborted) return Promise.reject(reason())

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(reason())

    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

async function resolveHost(
  hostname: string,
  label: string,
  dependencies: SafeFetchDependencies,
): Promise<ResolvedAddress[]> {
  const version = ipVersion(hostname)

  if (version !== 0) return [{ address: hostname, family: version }]

  let records: readonly LookupResult[]

  try {
    records = await dependencies.lookup(hostname)
  } catch (error) {
    throw new SafeFetchError(
      SafeFetchErrorCode.DNS_FAILURE,
      `${label} has no resolvable address`,
      { cause: error },
    )
  }

  if (records.length === 0) {
    throw new SafeFetchError(
      SafeFetchErrorCode.DNS_FAILURE,
      `${label} has no resolvable address`,
    )
  }

  // Fail closed on the WHOLE set: a rebinding answer often mixes one public
  // and one private address, and happy-eyeballs may dial either.
  for (const record of records) {
    if (dependencies.isBlockedAddress(record.address)) {
      throw new UnsafeUrlError(
        UnsafeUrlReason.BLOCKED_ADDRESS,
        `${label} targets a blocked host or address range`,
      )
    }
  }

  return records.map((record) => ({
    address: normalizeAddress(record.address),
    family: record.family === 6 ? 6 : 4,
  }))
}

/** A `lookup` that only ever answers with the addresses already vetted. */
function pinnedLookup(
  expectedHost: string,
  addresses: readonly ResolvedAddress[],
): LookupFunction {
  return (hostname, options, callback) => {
    if (normalizeAddress(hostname) !== expectedHost) {
      callback(new Error("Resolution target changed mid-request"), "", 4)

      return
    }

    const wanted =
      options.family === 4 || options.family === 6
        ? addresses.filter((entry) => entry.family === options.family)
        : addresses

    if (options.all === true) {
      callback(
        null,
        wanted.map((entry) => ({
          address: entry.address,
          family: entry.family,
        })),
      )

      return
    }

    const first = wanted[0]

    if (first === undefined) {
      callback(new Error("No address of the requested family"), "", 4)

      return
    }

    callback(null, first.address, first.family)
  }
}

type SupportedBody =
  | string
  | URLSearchParams
  | ArrayBuffer
  | ArrayBufferView
  | Blob

function isSupportedBody(body: unknown): body is SupportedBody {
  return (
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof Blob
  )
}

interface EncodedBody {
  bytes: Buffer
  contentType: string | undefined
}

async function encodeBody(
  body: RequestInit["body"],
): Promise<EncodedBody | undefined> {
  if (body === null || body === undefined) return undefined

  if (!isSupportedBody(body)) {
    throw new SafeFetchError(
      SafeFetchErrorCode.UNSUPPORTED_BODY,
      "Body must be a string, URLSearchParams, ArrayBuffer, typed array or Blob",
    )
  }

  if (typeof body === "string") {
    return { bytes: Buffer.from(body), contentType: "text/plain;charset=UTF-8" }
  }

  if (body instanceof URLSearchParams) {
    return {
      bytes: Buffer.from(body.toString()),
      contentType: "application/x-www-form-urlencoded;charset=UTF-8",
    }
  }

  if (body instanceof Blob) {
    return {
      bytes: Buffer.from(await body.arrayBuffer()),
      contentType: body.type === "" ? undefined : body.type,
    }
  }

  if (body instanceof ArrayBuffer) {
    return { bytes: Buffer.from(body), contentType: undefined }
  }

  return {
    bytes: Buffer.from(body.buffer, body.byteOffset, body.byteLength),
    contentType: undefined,
  }
}

function normalizeMethod(method: string | undefined): string {
  const value = method ?? "GET"

  if (!METHOD_TOKEN.test(value)) {
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

/** Counts bytes and fails the stream once the cap is passed. */
class ByteLimit extends Transform {
  #seen = 0
  readonly #limit: number

  constructor(limit: number) {
    super()
    this.#limit = limit
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.#seen += chunk.byteLength

    if (this.#seen > this.#limit) {
      callback(
        new SafeFetchError(
          SafeFetchErrorCode.RESPONSE_TOO_LARGE,
          `Response body exceeded ${this.#limit} bytes`,
        ),
      )

      return
    }

    callback(null, chunk)
  }
}

function decoderFor(coding: string): Transform | undefined {
  switch (coding) {
    case "gzip":
    case "x-gzip":
    case "deflate":
      return zlib.createUnzip()
    case "br":
      return zlib.createBrotliDecompress()
    default:
      return undefined
  }
}

/**
 * The decoders for a `Content-Encoding` header, in the order to apply them
 * (the header lists codings in the order they were APPLIED), or `null` when
 * a coding is unknown or the stack is too deep. An unknown coding is
 * refused rather than passed through: the size cap could only count the
 * encoded bytes, and the caller would decode a bomb with no limit.
 */
function decodersFor(header: string | null): Transform[] | null {
  const codings = (header ?? "")
    .split(",")
    .map((coding) => coding.trim().toLowerCase())
    .filter((coding) => coding !== "" && coding !== "identity")

  if (codings.length > MAX_CONTENT_ENCODINGS) return null

  const decoders: Transform[] = []

  for (const coding of codings.reverse()) {
    const decoder = decoderFor(coding)

    if (decoder === undefined) return null

    decoders.push(decoder)
  }

  return decoders
}

interface HopRequest {
  url: URL
  method: string
  headers: Headers
  body: Buffer | undefined
}

interface HopContext {
  addresses: readonly ResolvedAddress[]
  signal: AbortSignal
  abortReason: () => unknown
  maxResponseBytes: number
  decompress: boolean
}

/**
 * The response body as a web stream over `incoming → decoders → limit`.
 *
 * Built by hand rather than with `Readable.toWeb`: cancelling a converted
 * stream while the pipe still feeds it enqueues into a closed controller
 * from an event handler, which crashes the process. Every way the stream
 * ends (done, error, cap, cancel, deadline) tears the whole chain down, so
 * the socket never outlives the request.
 */
function bodyStream(
  incoming: http.IncomingMessage,
  decoders: readonly Transform[],
  maxBytes: number,
  onClose: () => void,
): ReadableStream<Uint8Array> {
  const limit = new ByteLimit(maxBytes)
  const stages: Array<Readable | Transform> = [incoming, ...decoders, limit]
  let open = true

  const teardown = (error?: Error): void => {
    if (!open) return

    open = false
    onClose()

    for (const stage of stages) {
      stage.unpipe()
      stage.destroy(error)
    }
  }

  let tail: Readable = incoming

  for (const stage of [...decoders, limit]) tail = tail.pipe(stage)

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const fail = (error: Error): void => {
        if (open) controller.error(error)
        teardown(error)
      }

      incoming.on("error", fail)

      for (const decoder of decoders) {
        decoder.on("error", (error) =>
          fail(
            new SafeFetchError(
              SafeFetchErrorCode.NETWORK_ERROR,
              "Response body could not be decoded",
              { cause: error },
            ),
          ),
        )
      }

      limit.on("error", fail)
      limit.on("data", (chunk: Buffer) => {
        if (!open) return

        controller.enqueue(new Uint8Array(chunk))

        if ((controller.desiredSize ?? 0) <= 0) limit.pause()
      })
      limit.once("end", () => {
        if (open) controller.close()
        teardown()
      })
      // A socket that closes before the body is complete is an error, not
      // a short body.
      incoming.once("close", () => {
        if (!incoming.complete) {
          fail(
            new SafeFetchError(
              SafeFetchErrorCode.NETWORK_ERROR,
              "Response ended before the body was complete",
            ),
          )
        }
      })
    },
    pull() {
      limit.resume()
    },
    cancel() {
      teardown()
    },
  })
}

/** One request, no redirect following, dialled to a pinned address. */
function requestOnce(hop: HopRequest, context: HopContext): Promise<Response> {
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
      const error = reason instanceof Error ? reason : new Error(String(reason))

      request.destroy(error)
      response?.destroy(error)

      if (!settled) {
        settled = true
        reject(reason)
      }
    }

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: host,
        port: url.port === "" ? (isHttps ? 443 : 80) : Number(url.port),
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

        const responseHeaders = new Headers()

        for (const [key, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const entry of value) responseHeaders.append(key, entry)
          } else if (value !== undefined) {
            responseHeaders.set(key, value)
          }
        }

        const init = {
          status,
          statusText: incoming.statusMessage ?? "",
          headers: responseHeaders,
        }
        const hasBody = !NULL_BODY_STATUSES.has(status) && hop.method !== "HEAD"

        if (!hasBody) {
          incoming.destroy()
          signal.removeEventListener("abort", onAbort)
          settled = true
          resolve(new Response(null, init))

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
        resolve(
          new Response(
            bodyStream(incoming, decoders, context.maxResponseBytes, () =>
              signal.removeEventListener("abort", onAbort),
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

    request.on("error", (error) => {
      signal.removeEventListener("abort", onAbort)

      if (settled) return

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

function sameOrigin(left: URL, right: URL): boolean {
  return left.origin === right.origin
}

/** Apply the fetch-standard redirect rewrites for the next hop. */
function nextHop(
  previous: HopRequest,
  status: number,
  location: URL,
): HopRequest {
  const headers = new Headers(previous.headers)
  let { method, body } = previous

  const downgradeToGet =
    (status === 303 && method !== "GET" && method !== "HEAD") ||
    ((status === 301 || status === 302) && method === "POST")

  if (downgradeToGet) {
    method = "GET"
    body = undefined

    for (const name of BODY_HEADERS) headers.delete(name)
  }

  if (!sameOrigin(previous.url, location)) {
    for (const name of CROSS_ORIGIN_STRIPPED) headers.delete(name)
  }

  return { url: location, method, headers, body }
}

function withResponseUrl(
  response: Response,
  url: URL,
  redirected: boolean,
): Response {
  Object.defineProperty(response, "url", { value: url.href })
  Object.defineProperty(response, "redirected", { value: redirected })

  return response
}

/**
 * Build a `safeFetch` with your own resolver or address ranges.
 *
 * ```ts
 * const fetchExternal = createSafeFetch({ blockedRanges: ["203.0.113.0/24"] })
 * ```
 *
 * The plain {@link safeFetch} export is `createSafeFetch()`.
 *
 * @throws {TypeError} when a range is not valid CIDR notation.
 */
export function createSafeFetch(
  config: SafeFetchConfig = {},
): typeof safeFetch {
  return fetchWith(dependenciesFor(config))
}

function fetchWith(dependencies: SafeFetchDependencies) {
  return async function safeFetch(
    input: string | URL,
    init: RequestInit = {},
    options: SafeFetchOptions = {},
  ): Promise<Response> {
    const label = options.label ?? "URL"
    const redirectMode = init.redirect ?? "error"
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
    const deadline = AbortSignal.timeout(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    const signal =
      init.signal === null || init.signal === undefined
        ? deadline
        : AbortSignal.any([init.signal, deadline])
    const abortReason = (): unknown =>
      init.signal?.aborted === true
        ? init.signal.reason
        : new SafeFetchError(
            SafeFetchErrorCode.TIMEOUT,
            `${label} did not complete within ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`,
          )

    const encoded = await encodeBody(init.body)
    const headers = new Headers(init.headers ?? undefined)

    for (const name of TRANSPORT_HEADERS) headers.delete(name)

    if (encoded?.contentType !== undefined && !headers.has("content-type")) {
      headers.set("content-type", encoded.contentType)
    }

    const decompress = options.decompress !== false

    if (decompress && !headers.has("accept-encoding")) {
      headers.set("accept-encoding", "gzip, deflate, br")
    }

    let hop: HopRequest = {
      url: checkUrl(input, options, dependencies.isBlockedAddress),
      method: normalizeMethod(init.method),
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
      const response = await requestOnce(hop, {
        addresses,
        signal,
        abortReason,
        maxResponseBytes:
          options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
        decompress,
      })

      const location = response.headers.get("location")

      if (
        !REDIRECT_STATUSES.has(response.status) ||
        redirectMode === "manual" ||
        location === null
      ) {
        return withResponseUrl(response, hop.url, redirects > 0)
      }

      await response.body?.cancel()

      if (redirectMode === "error") {
        throw new SafeFetchError(
          SafeFetchErrorCode.REDIRECT_NOT_ALLOWED,
          `${label} returned a redirect`,
        )
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
      hop = nextHop(
        hop,
        response.status,
        checkUrl(target, options, dependencies.isBlockedAddress),
      )
    }
  }
}

/**
 * `fetch` for URLs you do not control.
 *
 * Validates the URL, resolves the hostname, refuses the request if ANY
 * resolved address is private or reserved, and then connects to exactly the
 * address it checked, so a DNS-rebinding answer between the check and the
 * connection cannot redirect it. Every redirect hop gets the same treatment,
 * credentials are dropped on cross-origin redirects, and the whole exchange
 * runs under one deadline and one decoded-size cap.
 *
 * Returns a standard `Response`. Differences from `fetch`:
 * - `init.redirect` defaults to `"error"`; pass `"follow"` to opt in.
 * - Request bodies must be a string, `URLSearchParams`, `ArrayBuffer`,
 *   typed array or `Blob` (no streams or `FormData`).
 * - No connection pooling, no proxy and no cookies.
 *
 * @throws {UnsafeUrlError} the URL, or an address it resolved to, is refused.
 * @throws {SafeFetchError} DNS, timeout, redirect, size or network failure.
 * @throws the caller's `init.signal.reason` when the caller aborts.
 */
export const safeFetch = fetchWith(defaultDependencies)

/**
 * Validate a URL and every address its hostname currently resolves to,
 * without making a request. Use it only when another library owns the
 * socket: the check and that library's own lookup are separate, so a
 * rebinding window remains. Prefer {@link safeFetch} whenever you can.
 *
 * @throws {UnsafeUrlError | SafeFetchError}
 */
export async function resolveSafeUrl(
  input: string | URL,
  policy: UrlPolicy = {},
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  const url = checkUrl(input, policy, defaultDependencies.isBlockedAddress)
  const addresses = await resolveHost(
    normalizeAddress(url.hostname),
    policy.label ?? "URL",
    defaultDependencies,
  )

  return { url, addresses }
}
