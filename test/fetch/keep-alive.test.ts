import { createServer, type Server } from "node:http"
import type { AddressInfo, Socket } from "node:net"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { SafeFetchErrorCode } from "../../src/errors/safe-fetch-error.js"
import { createSafeFetch } from "../../src/fetch/create-safe-fetch.js"
import type { LookupResult } from "../../src/interfaces/safe-fetch-config.js"

// A server of its own: these tests count TCP connections, which the shared
// test server does not expose.
let server: Server
let port = 0
let connections = 0
const closed: Socket[] = []
const served = new WeakMap<Socket, number>()
let hintSocket: Socket | undefined

function lookup(): Promise<readonly LookupResult[]> {
  return Promise.resolve([{ address: "127.0.0.1", family: 4 }])
}

/** A pooling and a non-pooling instance over the loopback server. */
function instance(keepAlive: boolean): ReturnType<typeof createSafeFetch> {
  return createSafeFetch({
    lookup,
    allowedRanges: ["127.0.0.1/32"],
    allowHttp: true,
    keepAlive,
  })
}

function url(host: string, path: string): string {
  return `http://${host}:${port}${path}`
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const socket = request.socket
    const count = (served.get(socket) ?? 0) + 1

    served.set(socket, count)

    switch (request.url) {
      case "/drop-on-reuse":
        // A server that closed an idle keep-alive socket as the next request
        // was being written to it.
        if (count > 1) {
          socket.destroy()

          return
        }

        response.end("first")

        return
      case "/short-keep-alive":
        hintSocket = socket
        // Node keeps a pooled socket for the hint minus one second.
        response.setHeader("keep-alive", "timeout=2")
        response.end("short")

        return
      case "/slow":
        // Longer than the pool's 4 s idle limit, within the deadline.
        setTimeout(() => response.end("slow"), 4_500)

        return
      case "/large":
        response.end("x".repeat(256 * 1024))

        return
      case "/upgrade":
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n",
        )

        return
      case undefined:
      default:
        response.end(`ok ${count}`)
    }
  })
  server.keepAliveTimeout = 10_000
  server.on("connection", (socket: Socket) => {
    connections += 1
    socket.on("close", () => closed.push(socket))
  })
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
})

beforeEach(() => {
  connections = 0
  closed.length = 0
})

describe("keepAlive", () => {
  it("opens a new connection per request by default", async () => {
    const safeFetch = instance(false)

    await (await safeFetch(url("a.test", "/ok"))).text()
    await (await safeFetch(url("a.test", "/ok"))).text()

    expect(connections).toBe(2)
  })

  it("reuses one connection for sequential requests to one host", async () => {
    const safeFetch = instance(true)

    expect(await (await safeFetch(url("a.test", "/ok"))).text()).toBe("ok 1")
    expect(await (await safeFetch(url("a.test", "/ok"))).text()).toBe("ok 2")
    expect(connections).toBe(1)
  })

  it("never shares a connection between two hostnames on one address", async () => {
    const safeFetch = instance(true)

    await (await safeFetch(url("a.test", "/ok"))).text()
    await (await safeFetch(url("b.test", "/ok"))).text()

    expect(connections).toBe(2)
  })

  it("never shares a connection between two instances", async () => {
    await (await instance(true)(url("a.test", "/ok"))).text()
    await (await instance(true)(url("a.test", "/ok"))).text()

    expect(connections).toBe(2)
  })

  it("closes, never reuses, a connection whose body was not read to its end", async () => {
    const safeFetch = instance(true)
    const first = await safeFetch(url("a.test", "/large"))

    await first.body?.cancel()
    await (await safeFetch(url("a.test", "/ok"))).text()

    expect(connections).toBe(2)
  })

  it("closes an idle connection when the server's keep-alive hint runs out", async () => {
    const safeFetch = instance(true)

    await (await safeFetch(url("a.test", "/short-keep-alive"))).text()
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Still pooled right after the response...
    expect(hintSocket).toBeDefined()
    expect(closed).not.toContain(hintSocket)

    await new Promise((resolve) => setTimeout(resolve, 1_500))

    // ...and closed once the server's hint ran out (2 s less Node's 1 s margin).
    expect(closed).toContain(hintSocket)
  })

  it("sends an idempotent request again on a new connection when its reused socket was closed", async () => {
    const safeFetch = instance(true)

    expect(
      await (await safeFetch(url("c.test", "/drop-on-reuse"))).text(),
    ).toBe("first")
    expect(
      await (await safeFetch(url("c.test", "/drop-on-reuse"))).text(),
    ).toBe("first")
    expect(connections).toBe(2)
  })

  it("never sends a POST twice", async () => {
    const safeFetch = instance(true)

    await (
      await safeFetch(url("d.test", "/drop-on-reuse"), { method: "POST" })
    ).text()

    await expect(
      safeFetch(url("d.test", "/drop-on-reuse"), { method: "POST" }),
    ).rejects.toMatchObject({ code: SafeFetchErrorCode.NETWORK_ERROR })
    expect(connections).toBe(1)
  })

  it("never cuts a slow response short with the pool's idle limit", async () => {
    const safeFetch = instance(true)
    const response = await safeFetch(
      url("e.test", "/slow"),
      {},
      {
        timeoutMs: 10_000,
      },
    )

    expect(await response.text()).toBe("slow")
  }, 15_000)

  it("refuses a keepAlive that is not a boolean", () => {
    expect(() =>
      createSafeFetch({ keepAlive: "yes" as unknown as boolean }),
    ).toThrow(TypeError)
  })
})

describe("101 Switching Protocols", () => {
  it.each([false, true])(
    "is refused at once, never left to the deadline (keepAlive: %s)",
    async (keepAlive) => {
      const started = Date.now()

      await expect(
        instance(keepAlive)(
          url("a.test", "/upgrade"),
          {},
          { timeoutMs: 5_000 },
        ),
      ).rejects.toMatchObject({ code: SafeFetchErrorCode.NETWORK_ERROR })
      expect(Date.now() - started).toBeLessThan(2_000)
    },
  )
})
