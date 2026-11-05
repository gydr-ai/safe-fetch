import type { LookupAddress } from "node:dns"
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"
import { brotliCompressSync, gzipSync } from "node:zlib"

// The test server listens on 127.0.0.1. The fetch tests treat 127.0.0.1 as a
// "public" address and 10.9.9.9 as the private target an attacker wants, so
// the real network policy is exercised without leaving the machine.
export const SERVER_IP = "127.0.0.1"
export const PRIVATE_IP = "10.9.9.9"

/** What the server saw of the last request, as `/echo` returns it. */
export interface EchoedRequest {
  method: string
  headers: IncomingMessage["headers"]
  body: string
}

/** Mutable state shared between the test server and the tests. */
export const fixture = {
  port: 0,
  lastRequest: { method: "", headers: {}, body: "" } as EchoedRequest,
  requests: [] as string[],
  lookups: [] as string[],
  dnsAnswers: {} as Record<string, LookupAddress[]>,
  stalled: [] as ServerResponse[],
}

let server: Server | undefined

/**
 * Redirect targets, registered by the tests. The `/redirect` route looks the
 * target up here by id, so no part of a request decides where it redirects.
 */
const redirectTargets = new Map<string, string>()
const redirectIds = new Map<string, string>()

/**
 * The path of a `/redirect` route that answers `status` with `Location:
 * target`. The same target and status always give the same path.
 *
 * @param target - Absolute or relative `Location` value to send.
 * @param status - Redirect status code. Default 302.
 * @returns A path such as `/redirect?id=3&status=302`.
 */
export function redirectPath(target: string, status = 302): string {
  let id = redirectIds.get(target)

  if (id === undefined) {
    id = String(redirectIds.size + 1)
    redirectIds.set(target, id)
    redirectTargets.set(id, target)
  }

  return `/redirect?id=${id}&status=${String(status)}`
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []

    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString())
    })
  })
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  {
    const url = new URL(request.url ?? "/", "http://placeholder")
    const body = await readBody(request)

    fixture.lastRequest = {
      method: request.method ?? "",
      headers: request.headers,
      body,
    }
    fixture.requests.push(url.pathname)

    switch (url.pathname) {
      case "/ok":
        response.setHeader("x-test", "yes")
        response.end("hello")
        return
      case "/echo":
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify(fixture.lastRequest))
        return
      case "/redirect": {
        response.statusCode = Number(url.searchParams.get("status") ?? 302)
        response.setHeader(
          "location",
          redirectTargets.get(url.searchParams.get("id") ?? "") ?? "/ok",
        )
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
        fixture.stalled.push(response)
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
  }
}

/** Start the test server on an ephemeral port of {@link SERVER_IP}. */
export async function startTestServer(): Promise<void> {
  const created = createServer((request, response) => {
    void handle(request, response)
  })

  server = created
  await new Promise<void>((resolve) => created.listen(0, SERVER_IP, resolve))
  fixture.port = (created.address() as AddressInfo).port
}

/** Stop the test server. */
export async function stopTestServer(): Promise<void> {
  await new Promise<void>((resolve) =>
    server?.close(() => {
      resolve()
    }),
  )
}

/** Reset the per-test state and the fake DNS answers. */
export function resetFixture(): void {
  fixture.requests.length = 0
  fixture.lookups.length = 0
  fixture.dnsAnswers = {
    "public.test": [{ address: SERVER_IP, family: 4 }],
    "other.test": [{ address: SERVER_IP, family: 4 }],
    "evil.test": [{ address: PRIVATE_IP, family: 4 }],
    "rebind.test": [
      { address: SERVER_IP, family: 4 },
      { address: PRIVATE_IP, family: 4 },
    ],
  }
}

/** A lookup that answers from {@link fixture}.dnsAnswers and records calls. */
export function fakeLookup(hostname: string): Promise<LookupAddress[]> {
  fixture.lookups.push(hostname)
  const answer = fixture.dnsAnswers[hostname]

  return answer === undefined
    ? Promise.reject(new Error("ENOTFOUND"))
    : Promise.resolve(answer)
}

/** A URL on the test server reached through `host`. */
export function at(host: string, path: string): string {
  return `http://${host}:${fixture.port}${path}`
}

/** Await a promise that must reject and return its rejection. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }

  throw new Error("expected a rejection")
}
