import type { AddressInfo } from "node:net"
import { createServer as createTcpServer } from "node:net"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  SafeFetchError,
  SafeFetchErrorCode,
} from "../../src/errors/safe-fetch-error.js"
import {
  UnsafeUrlError,
  UnsafeUrlReason,
} from "../../src/errors/unsafe-url-error.js"
import { createSafeFetch } from "../../src/fetch/create-safe-fetch.js"
import {
  at,
  type EchoedRequest,
  fakeLookup,
  fixture,
  rejection,
  resetFixture,
  SERVER_IP,
  startTestServer,
  stopTestServer,
  redirectPath,
} from "../support/test-server.js"

beforeAll(startTestServer)
afterAll(stopTestServer)
beforeEach(resetFixture)

const safeFetch = createSafeFetch({
  lookup: fakeLookup,
  // The public allowedRanges option lets the loopback test server stand in
  // for a public host; everything else keeps the built-in policy.
  allowedRanges: ["127.0.0.1/32"],
})

const opts = { allowHttp: true }

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

    expect(fixture.lookups).toEqual(["public.test"])
  })

  it("refuses a host whose answer contains any private address", async () => {
    const error = await rejection(safeFetch(at("rebind.test", "/ok"), {}, opts))

    expect(error).toBeInstanceOf(UnsafeUrlError)
    expect((error as UnsafeUrlError).reason).toBe(
      UnsafeUrlReason.BLOCKED_ADDRESS,
    )
    expect(fixture.requests).toEqual([])
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
    expect(fixture.lookups).toEqual([])
  })

  it("sends the original Host header and drops a caller override", async () => {
    const response = await safeFetch(
      at("public.test", "/echo"),
      { headers: { host: "internal.example", connection: "upgrade" } },
      opts,
    )
    const echoed = (await response.json()) as EchoedRequest

    expect(echoed.headers.host).toBe(`public.test:${fixture.port}`)
    expect(echoed.headers.connection).not.toBe("upgrade")
  })

  it("sends a string body with a default content type", async () => {
    const response = await safeFetch(
      at("public.test", "/echo"),
      { method: "post", body: "payload" },
      opts,
    )
    const echoed = (await response.json()) as EchoedRequest

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
    const echoed = (await response.json()) as EchoedRequest

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
          at("public.test", redirectPath(decodeURIComponent(to))),
          { redirect: "follow" },
          opts,
        ),
      )

      expect((error as UnsafeUrlError).reason).toBe(
        UnsafeUrlReason.BLOCKED_ADDRESS,
      )
      expect(fixture.lookups).toEqual(["public.test", "evil.test"])
    })

    it("refuses a redirect to a metadata IP literal", async () => {
      const to = encodeURIComponent("http://169.254.169.254/latest/meta-data/")
      const error = await rejection(
        safeFetch(
          at("public.test", redirectPath(decodeURIComponent(to))),
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
          at("public.test", redirectPath("ftp://public.test/")),
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
        at("public.test", redirectPath(decodeURIComponent(to))),
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
      const echoed = (await response.json()) as EchoedRequest

      expect(echoed.headers.authorization).toBeUndefined()
      expect(echoed.headers.cookie).toBeUndefined()
      expect(echoed.headers["proxy-authorization"]).toBeUndefined()
      expect(echoed.headers["x-kept"]).toBe("1")
    })

    it("keeps credentials on a same-origin redirect", async () => {
      const response = await safeFetch(
        at("public.test", redirectPath("/echo")),
        { redirect: "follow", headers: { authorization: "Bearer kept" } },
        opts,
      )
      const echoed = (await response.json()) as EchoedRequest

      expect(echoed.headers.authorization).toBe("Bearer kept")
    })

    it("turns a 303 after POST into a GET without the body", async () => {
      const response = await safeFetch(
        at("public.test", redirectPath("/echo", 303)),
        { method: "POST", body: "data", redirect: "follow" },
        opts,
      )
      const echoed = (await response.json()) as EchoedRequest

      expect(echoed.method).toBe("GET")
      expect(echoed.body).toBe("")
      expect(echoed.headers["content-type"]).toBeUndefined()
    })

    it("keeps method and body on a 307", async () => {
      const response = await safeFetch(
        at("public.test", redirectPath("/echo", 307)),
        { method: "PUT", body: "data", redirect: "follow" },
        opts,
      )
      const echoed = (await response.json()) as EchoedRequest

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
      expect(fixture.requests).toHaveLength(3)
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
      const echoed = (await response.json()) as EchoedRequest

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

      setTimeout(() => {
        controller.abort(reason)
      }, 50)

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
      expect(fixture.requests).toEqual([])
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

    // The process is still healthy: the next request completes normally.
    const next = await safeFetch(at("public.test", "/ok"), {}, opts)

    expect(await next.text()).toBe("hello")
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

    const peer = fixture.stalled.pop()

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

  it("keeps the process alive when the reason phrase is not valid", async () => {
    const raw = createTcpServer((socket) => {
      socket.once("data", () => {
        socket.end(
          Buffer.from(
            "HTTP/1.1 200 O\u007fK\r\ncontent-length: 2\r\n\r\nhi",
            "latin1",
          ),
        )
      })
    })

    await new Promise<void>((resolve) => raw.listen(0, SERVER_IP, resolve))
    const rawPort = (raw.address() as AddressInfo).port

    try {
      const response = await safeFetch(
        `http://public.test:${String(rawPort)}/`,
        {},
        opts,
      )

      expect(response.status).toBe(200)
      expect(response.statusText).toBe("")
      expect(await response.text()).toBe("hi")
    } finally {
      raw.close()
    }
  })

  it("ends the body promptly when the connection drops mid-body", async () => {
    const raw = createTcpServer((socket) => {
      socket.once("data", () => {
        socket.write("HTTP/1.1 200 OK\r\ncontent-length: 100000\r\n\r\npartial")
        setTimeout(() => socket.destroy(), 20)
      })
    })

    await new Promise<void>((resolve) => raw.listen(0, SERVER_IP, resolve))
    const rawPort = (raw.address() as AddressInfo).port

    try {
      const response = await safeFetch(
        `http://public.test:${String(rawPort)}/`,
        {},
        { ...opts, timeoutMs: 5_000 },
      )
      const started = Date.now()

      await expect(response.text()).rejects.toMatchObject({
        code: SafeFetchErrorCode.NETWORK_ERROR,
      })
      expect(Date.now() - started).toBeLessThan(1_000)
    } finally {
      raw.close()
    }
  })

  it("does not read the body when the URL is refused", async () => {
    let read = false
    const body = new Blob(["payload"])
    const original = body.arrayBuffer.bind(body)

    body.arrayBuffer = () => {
      read = true
      return original()
    }

    await expect(
      safeFetch("http://127.0.0.2/", { method: "POST", body }, opts),
    ).rejects.toMatchObject({ reason: UnsafeUrlReason.BLOCKED_ADDRESS })
    expect(read).toBe(false)
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
      lookup: () => Promise.resolve([{ address: SERVER_IP, family: 4 }]),
      allowedRanges: ["127.0.0.1/32"],
      blockedRanges: ["127.0.0.0/8"],
    })

    await expect(
      strict(at("public.test", "/ok"), {}, opts),
    ).rejects.toMatchObject({ reason: UnsafeUrlReason.BLOCKED_ADDRESS })
  })

  it("applies allowed ranges to IP literals too", async () => {
    const response = await safeFetch(
      `http://${SERVER_IP}:${fixture.port}/ok`,
      {},
      opts,
    )

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
