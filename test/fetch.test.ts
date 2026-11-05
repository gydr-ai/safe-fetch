import type { LookupAddress } from "node:dns"
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"
import { createServer as createTcpServer } from "node:net"
import { brotliCompressSync, gzipSync } from "node:zlib"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  createSafeFetch,
  resolveSafeUrl,
  SafeFetchError,
  SafeFetchErrorCode,
} from "../src/fetch.js"
import { UnsafeUrlError, UnsafeUrlReason } from "../src/url.js"

// The test server listens on 127.0.0.1. These tests treat 127.0.0.1 as a
// "public" address and 10.9.9.9 as the private target an attacker wants, so
// the real network policy is exercised without leaving the machine.
const SERVER_IP = "127.0.0.1"
const PRIVATE_IP = "10.9.9.9"

let server: Server
let port = 0
let lastRequest: {
  method: string
  headers: IncomingMessage["headers"]
  body: string
}
const requests: string[] = []
const lookups: string[] = []
let dnsAnswers: Record<string, LookupAddress[]> = {}
const stalled: ServerResponse[] = []

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []

    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks).toString()))
  })
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://placeholder")
    const body = await readBody(request)

    lastRequest = {
      method: request.method ?? "",
      headers: request.headers,
      body,
    }
    requests.push(url.pathname)

    switch (url.pathname) {
      case "/ok":
        response.setHeader("x-test", "yes")
        response.end("hello")
        return
      case "/echo":
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify(lastRequest))
        return
      case "/redirect": {
        response.statusCode = Number(url.searchParams.get("status") ?? 302)
        response.setHeader("location", url.searchParams.get("to") ?? "/ok")
        response.end()
        return
      }
      case "/redirect-with-body":
        response.statusCode = 302
        response.setHeader("location", "/ok")
        response.end("x".repeat(200_000))
        return
      case "/stall-over-cap":
        response.write("x".repeat(5000))
        stalled.push(response)
        return
      case "/gzip-twice":
        response.setHeader("content-encoding", "gzip, gzip")
        response.end(gzipSync(gzipSync("twice")))
        return
      case "/bad-gzip":
        response.setHeader("content-encoding", "gzip")
        response.end("not gzip at all")
        return
      case "/unknown-encoding":
        response.setHeader("content-encoding", "zstd")
        response.end("opaque")
        return
      case "/loop":
        response.statusCode = 302
        response.setHeader("location", "/loop")
        response.end()
        return
      case "/big-declared":
        response.setHeader("content-length", "5000")
        response.end("x".repeat(5000))
        return
      case "/big-chunked":
        response.write("x".repeat(3000))
        response.end("x".repeat(3000))
        return
      case "/gzip":
        response.setHeader("content-encoding", "gzip")
        response.end(gzipSync("compressed hello"))
        return
      case "/br":
        response.setHeader("content-encoding", "br")
        response.end(brotliCompressSync("brotli hello"))
        return
      case "/bomb":
        response.setHeader("content-encoding", "gzip")
        response.end(gzipSync(Buffer.alloc(50 * 1024 * 1024)))
        return
      case "/slow":
        setTimeout(() => response.end("late"), 500)
        return
      case "/slow-body":
        response.write("start")
        setTimeout(() => response.end("end"), 500)
        return
      case "/no-content":
        response.statusCode = 204
        response.end()
        return
      default:
        response.statusCode = 404
        response.end()
    }
  })

  await new Promise<void>((resolve) => server.listen(0, SERVER_IP, resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  requests.length = 0
  lookups.length = 0
  dnsAnswers = {
    "public.test": [{ address: SERVER_IP, family: 4 }],
    "other.test": [{ address: SERVER_IP, family: 4 }],
    "evil.test": [{ address: PRIVATE_IP, family: 4 }],
    "rebind.test": [
      { address: SERVER_IP, family: 4 },
      { address: PRIVATE_IP, family: 4 },
    ],
  }
})

const safeFetch = createSafeFetch({
  lookup: async (hostname) => {
    lookups.push(hostname)
    const answer = dnsAnswers[hostname]

    if (answer === undefined) throw new Error("ENOTFOUND")

    return answer
  },
  // The public allowedRanges option lets the loopback test server stand in
  // for a public host; everything else keeps the built-in policy.
  allowedRanges: ["127.0.0.1/32"],
})

const opts = { allowHttp: true }
const at = (host: string, path: string): string =>
  `http://${host}:${port}${path}`

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }

  throw new Error("expected a rejection")
}

describe("safeFetch", () => {
  it("returns a standard Response for an allowed host", async () => {
    const response = await safeFetch(at("public.test", "/ok"), {}, opts)

    expect(response.status).toBe(200)
    expect(response.headers.get("x-test")).toBe("yes")
    expect(await response.text()).toBe("hello")
    expect(response.url).toBe(at("public.test", "/ok"))
    expect(response.redirected).toBe(false)
  })

  it("resolves once and connects to the address it checked", async () => {
    await (await safeFetch(at("public.test", "/ok"), {}, opts)).text()

    expect(lookups).toEqual(["public.test"])
  })

  it("refuses a host whose answer contains any private address", async () => {
    const error = await rejection(safeFetch(at("rebind.test", "/ok"), {}, opts))

    expect(error).toBeInstanceOf(UnsafeUrlError)
    expect((error as UnsafeUrlError).reason).toBe(
      UnsafeUrlReason.BLOCKED_ADDRESS,
    )
    expect(requests).toEqual([])
  })

  it("reports a name that does not resolve", async () => {
    const error = await rejection(
      safeFetch(at("missing.test", "/ok"), {}, opts),
    )

    expect((error as SafeFetchError).code).toBe(SafeFetchErrorCode.DNS_FAILURE)
  })

  it("refuses a private IP literal without a lookup", async () => {
    const error = await rejection(
      safeFetch("http://[::ffff:169.254.169.254]/", {}, opts),
    )

    expect((error as UnsafeUrlError).reason).toBe(
      UnsafeUrlReason.BLOCKED_ADDRESS,
    )
    expect(lookups).toEqual([])
  })

  it("sends the original Host header and drops a caller override", async () => {
    const response = await safeFetch(
      at("public.test", "/echo"),
      { headers: { host: "internal.example", connection: "upgrade" } },
      opts,
    )
    const echoed = (await response.json()) as typeof lastRequest

    expect(echoed.headers.host).toBe(`public.test:${port}`)
    expect(echoed.headers.connection).not.toBe("upgrade")
  })

  it("sends a string body with a default content type", async () => {
    const response = await safeFetch(
      at("public.test", "/echo"),
      { method: "post", body: "payload" },
      opts,
    )
    const echoed = (await response.json()) as typeof lastRequest

    expect(echoed.method).toBe("POST")
    expect(echoed.body).toBe("payload")
    expect(echoed.headers["content-type"]).toBe("text/plain;charset=UTF-8")
    expect(echoed.headers["content-length"]).toBe("7")
  })

  it.each([
    [new URLSearchParams({ a: "1" }), "a=1"],
    [new TextEncoder().encode("bytes"), "bytes"],
    [new TextEncoder().encode("buffer").buffer, "buffer"],
    [new Blob(["blob"], { type: "text/x-test" }), "blob"],
  ])("encodes the body %#", async (body, expected) => {
    const response = await safeFetch(
      at("public.test", "/echo"),
      { method: "POST", body },
      opts,
    )
    const echoed = (await response.json()) as typeof lastRequest

    expect(echoed.body).toBe(expected)
  })

  it("refuses streaming bodies and forbidden methods", async () => {
    const stream = await rejection(
      safeFetch(
        at("public.test", "/echo"),
        { method: "POST", body: new ReadableStream() },
        opts,
      ),
    )
    const connect = await rejection(
      safeFetch(at("public.test", "/ok"), { method: "CONNECT" }, opts),
    )

    expect((stream as SafeFetchError).code).toBe(
      SafeFetchErrorCode.UNSUPPORTED_BODY,
    )
    expect((connect as SafeFetchError).code).toBe(
      SafeFetchErrorCode.UNSUPPORTED_METHOD,
    )
  })

  it("returns no body for HEAD and 204", async () => {
    const head = await safeFetch(
      at("public.test", "/ok"),
      { method: "HEAD" },
      opts,
    )
    const empty = await safeFetch(at("public.test", "/no-content"), {}, opts)

    expect(head.body).toBeNull()
    expect(empty.status).toBe(204)
    expect(empty.body).toBeNull()
  })

  describe("redirects", () => {
    it("refuses a redirect by default", async () => {
      const error = await rejection(
        safeFetch(at("public.test", "/redirect"), {}, opts),
      )

      expect((error as SafeFetchError).code).toBe(
        SafeFetchErrorCode.REDIRECT_NOT_ALLOWED,
      )
    })

    it("returns the redirect itself in manual mode", async () => {
      const response = await safeFetch(
        at("public.test", "/redirect"),
        { redirect: "manual" },
        opts,
      )

      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe("/ok")
    })

    it("follows a safe redirect and reports the final URL", async () => {
      const response = await safeFetch(
        at("public.test", "/redirect"),
        { redirect: "follow" },
        opts,
      )

      expect(await response.text()).toBe("hello")
      expect(response.url).toBe(at("public.test", "/ok"))
      expect(response.redirected).toBe(true)
    })

    it("re-checks every hop and refuses a redirect to a private host", async () => {
      const to = encodeURIComponent(at("evil.test", "/ok"))
      const error = await rejection(
        safeFetch(
          at("public.test", `/redirect?to=${to}`),
          { redirect: "follow" },
          opts,
        ),
      )

      expect((error as UnsafeUrlError).reason).toBe(
        UnsafeUrlReason.BLOCKED_ADDRESS,
      )
      expect(lookups).toEqual(["public.test", "evil.test"])
    })

    it("refuses a redirect to a metadata IP literal", async () => {
      const to = encodeURIComponent("http://169.254.169.254/latest/meta-data/")
      const error = await rejection(
        safeFetch(
          at("public.test", `/redirect?to=${to}`),
          { redirect: "follow" },
          opts,
        ),
      )

      expect((error as UnsafeUrlError).reason).toBe(
        UnsafeUrlReason.BLOCKED_ADDRESS,
      )
    })

    it("refuses a redirect that downgrades to http when only https is allowed", async () => {
      // Exercised through the policy: the hop is judged with the same options.
      const error = await rejection(
        safeFetch(
          at(
            "public.test",
            `/redirect?to=${encodeURIComponent("ftp://public.test/")}`,
          ),
          { redirect: "follow" },
          opts,
        ),
      )

      expect((error as UnsafeUrlError).reason).toBe(
        UnsafeUrlReason.PROTOCOL_NOT_ALLOWED,
      )
    })

    it("drops credentials on a cross-origin redirect", async () => {
      const to = encodeURIComponent(at("other.test", "/echo"))
      const response = await safeFetch(
        at("public.test", `/redirect?to=${to}`),
        {
          redirect: "follow",
          headers: {
            authorization: "Bearer secret",
            cookie: "session=secret",
            "proxy-authorization": "Basic secret",
            "x-kept": "1",
          },
        },
        opts,
      )
      const echoed = (await response.json()) as typeof lastRequest

      expect(echoed.headers.authorization).toBeUndefined()
      expect(echoed.headers.cookie).toBeUndefined()
      expect(echoed.headers["proxy-authorization"]).toBeUndefined()
      expect(echoed.headers["x-kept"]).toBe("1")
    })

    it("keeps credentials on a same-origin redirect", async () => {
      const response = await safeFetch(
        at("public.test", "/redirect?to=/echo"),
        { redirect: "follow", headers: { authorization: "Bearer kept" } },
        opts,
      )
      const echoed = (await response.json()) as typeof lastRequest

      expect(echoed.headers.authorization).toBe("Bearer kept")
    })

    it("turns a 303 after POST into a GET without the body", async () => {
      const response = await safeFetch(
        at("public.test", "/redirect?status=303&to=/echo"),
        { method: "POST", body: "data", redirect: "follow" },
        opts,
      )
      const echoed = (await response.json()) as typeof lastRequest

      expect(echoed.method).toBe("GET")
      expect(echoed.body).toBe("")
      expect(echoed.headers["content-type"]).toBeUndefined()
    })

    it("keeps method and body on a 307", async () => {
      const response = await safeFetch(
        at("public.test", "/redirect?status=307&to=/echo"),
        { method: "PUT", body: "data", redirect: "follow" },
        opts,
      )
      const echoed = (await response.json()) as typeof lastRequest

      expect(echoed.method).toBe("PUT")
      expect(echoed.body).toBe("data")
    })

    it("stops after the redirect limit", async () => {
      const error = await rejection(
        safeFetch(
          at("public.test", "/loop"),
          { redirect: "follow" },
          { ...opts, maxRedirects: 2 },
        ),
      )

      expect((error as SafeFetchError).code).toBe(
        SafeFetchErrorCode.TOO_MANY_REDIRECTS,
      )
      expect(requests).toHaveLength(3)
    })
  })

  describe("size limits and decoding", () => {
    it("refuses a declared length over the cap before reading", async () => {
      const error = await rejection(
        safeFetch(
          at("public.test", "/big-declared"),
          {},
          {
            ...opts,
            maxResponseBytes: 1000,
          },
        ),
      )

      expect((error as SafeFetchError).code).toBe(
        SafeFetchErrorCode.RESPONSE_TOO_LARGE,
      )
    })

    it("stops a streamed body at the cap", async () => {
      const response = await safeFetch(
        at("public.test", "/big-chunked"),
        {},
        {
          ...opts,
          maxResponseBytes: 4000,
        },
      )
      const error = await rejection(response.text())

      expect(error).toBeInstanceOf(SafeFetchError)
      expect((error as SafeFetchError).code).toBe(
        SafeFetchErrorCode.RESPONSE_TOO_LARGE,
      )
    })

    it("decodes gzip and brotli and strips the encoding headers", async () => {
      const gzip = await safeFetch(at("public.test", "/gzip"), {}, opts)
      const br = await safeFetch(at("public.test", "/br"), {}, opts)

      expect(await gzip.text()).toBe("compressed hello")
      expect(gzip.headers.get("content-encoding")).toBeNull()
      expect(await br.text()).toBe("brotli hello")
    })

    it("advertises the encodings it decodes", async () => {
      const response = await safeFetch(at("public.test", "/echo"), {}, opts)
      const echoed = (await response.json()) as typeof lastRequest

      expect(echoed.headers["accept-encoding"]).toBe("gzip, deflate, br")
    })

    it("leaves the body encoded when decompression is off", async () => {
      const response = await safeFetch(
        at("public.test", "/gzip"),
        {},
        {
          ...opts,
          decompress: false,
        },
      )

      expect(response.headers.get("content-encoding")).toBe("gzip")
      expect(Buffer.from(await response.arrayBuffer())[0]).toBe(0x1f)
    })

    it("stops a decompression bomb at the decoded cap", async () => {
      const response = await safeFetch(
        at("public.test", "/bomb"),
        {},
        {
          ...opts,
          maxResponseBytes: 1024 * 1024,
        },
      )
      const error = await rejection(response.arrayBuffer())

      expect((error as SafeFetchError).code).toBe(
        SafeFetchErrorCode.RESPONSE_TOO_LARGE,
      )
    })
  })

  describe("deadlines", () => {
    it("times out waiting for headers", async () => {
      const error = await rejection(
        safeFetch(at("public.test", "/slow"), {}, { ...opts, timeoutMs: 100 }),
      )

      expect((error as SafeFetchError).code).toBe(SafeFetchErrorCode.TIMEOUT)
    })

    it("times out while reading the body", async () => {
      const response = await safeFetch(
        at("public.test", "/slow-body"),
        {},
        {
          ...opts,
          timeoutMs: 150,
        },
      )
      const error = await rejection(response.text())

      expect(error).toBeInstanceOf(Error)
    })

    it("rethrows the caller's abort reason", async () => {
      const controller = new AbortController()
      const reason = new Error("caller gave up")
      const pending = safeFetch(
        at("public.test", "/slow"),
        {
          signal: controller.signal,
        },
        opts,
      )

      setTimeout(() => controller.abort(reason), 50)

      expect(await rejection(pending)).toBe(reason)
    })

    it("refuses to start with an already aborted signal", async () => {
      const reason = new Error("already")
      const error = await rejection(
        safeFetch(
          at("public.test", "/ok"),
          { signal: AbortSignal.abort(reason) },
          opts,
        ),
      )

      expect(error).toBe(reason)
      expect(requests).toEqual([])
    })
  })
})

describe("hostile servers", () => {
  it("survives a redirect that carries a body", async () => {
    await expect(
      safeFetch(at("public.test", "/redirect-with-body"), {}, opts),
    ).rejects.toMatchObject({ code: SafeFetchErrorCode.REDIRECT_NOT_ALLOWED })

    const followed = await safeFetch(
      at("public.test", "/redirect-with-body"),
      { redirect: "follow" },
      opts,
    )

    expect(await followed.text()).toBe("hello")
  })

  it("survives the caller cancelling the body", async () => {
    const response = await safeFetch(
      at("public.test", "/big-chunked"),
      {},
      opts,
    )

    await response.body?.cancel()
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  it("closes the socket when the size cap is hit on a stalled body", async () => {
    const response = await safeFetch(
      at("public.test", "/stall-over-cap"),
      {},
      {
        ...opts,
        maxResponseBytes: 1000,
      },
    )

    await expect(response.text()).rejects.toMatchObject({
      code: SafeFetchErrorCode.RESPONSE_TOO_LARGE,
    })

    const peer = stalled.pop()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(peer?.socket?.destroyed ?? true).toBe(true)
  })

  it("rejects a status outside 200-599 instead of crashing", async () => {
    const raw = createTcpServer((socket) => {
      socket.once("data", () => {
        socket.end("HTTP/1.1 600 Weird\r\ncontent-length: 0\r\n\r\n")
      })
    })

    await new Promise<void>((resolve) => raw.listen(0, SERVER_IP, resolve))
    const rawPort = (raw.address() as AddressInfo).port

    try {
      await expect(
        safeFetch(`http://public.test:${rawPort}/`, {}, opts),
      ).rejects.toMatchObject({ code: SafeFetchErrorCode.NETWORK_ERROR })
    } finally {
      raw.close()
    }
  })

  it.each(["GET\r\nX: y", "G T", ""])(
    "refuses the invalid method %j as a SafeFetchError",
    async (method) => {
      await expect(
        safeFetch(at("public.test", "/ok"), { method }, opts),
      ).rejects.toMatchObject({ code: SafeFetchErrorCode.UNSUPPORTED_METHOD })
    },
  )

  it("decodes stacked encodings", async () => {
    const response = await safeFetch(at("public.test", "/gzip-twice"), {}, opts)

    expect(await response.text()).toBe("twice")
  })

  it("reports a corrupt compressed body as a SafeFetchError", async () => {
    const response = await safeFetch(at("public.test", "/bad-gzip"), {}, opts)

    await expect(response.text()).rejects.toMatchObject({
      code: SafeFetchErrorCode.NETWORK_ERROR,
    })
  })

  it("refuses an encoding it cannot decode", async () => {
    await expect(
      safeFetch(at("public.test", "/unknown-encoding"), {}, opts),
    ).rejects.toMatchObject({ code: SafeFetchErrorCode.UNSUPPORTED_ENCODING })
  })
})

describe("createSafeFetch configuration", () => {
  it("refuses extra blocked ranges on top of the built-in list", async () => {
    const strict = createSafeFetch({
      lookup: async () => [{ address: SERVER_IP, family: 4 }],
      allowedRanges: ["127.0.0.1/32"],
      blockedRanges: ["127.0.0.0/8"],
    })

    await expect(
      strict(at("public.test", "/ok"), {}, opts),
    ).rejects.toMatchObject({ reason: UnsafeUrlReason.BLOCKED_ADDRESS })
  })

  it("applies allowed ranges to IP literals too", async () => {
    const response = await safeFetch(`http://${SERVER_IP}:${port}/ok`, {}, opts)

    expect(await response.text()).toBe("hello")
  })

  it("keeps blocking ranges that were not allowed", async () => {
    await expect(
      safeFetch("http://[::ffff:169.254.169.254]/", {}, opts),
    ).rejects.toMatchObject({ reason: UnsafeUrlReason.BLOCKED_ADDRESS })
  })

  it.each([
    "10.0.0.0",
    "10.0.0.0/33",
    "nope/8",
    "10.0.0.0/8/1",
    "::/129",
    "1.2.3.4/x",
  ])("rejects the invalid range %j at construction", (range) => {
    expect(() => createSafeFetch({ blockedRanges: [range] })).toThrow(TypeError)
    expect(() => createSafeFetch({ allowedRanges: [range] })).toThrow(TypeError)
  })
})

describe("resolveSafeUrl", () => {
  it("returns a public IP literal without a lookup", async () => {
    const result = await resolveSafeUrl("https://1.1.1.1/dns-query")

    expect(result.addresses).toEqual([{ address: "1.1.1.1", family: 4 }])
  })

  it("refuses a private literal", async () => {
    await expect(resolveSafeUrl("https://10.0.0.1/")).rejects.toBeInstanceOf(
      UnsafeUrlError,
    )
  })
})
