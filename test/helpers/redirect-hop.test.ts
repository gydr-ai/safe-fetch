import { describe, expect, it } from "vitest"

import { nextHop } from "../../src/helpers/redirect-hop.js"
import type { HopRequest } from "../../src/interfaces/hop.js"

function hop(method: string): HopRequest {
  return {
    url: new URL("https://a.example/start"),
    method,
    headers: new Headers({
      authorization: "secret",
      "content-type": "text/plain",
      "x-api-key": "key",
    }),
    body: Buffer.from("body"),
  }
}

describe("nextHop", () => {
  it.each([
    [303, "PUT", "GET"],
    [303, "HEAD", "HEAD"],
    [301, "POST", "GET"],
    [302, "POST", "GET"],
    [302, "PUT", "PUT"],
    [307, "POST", "POST"],
    [308, "POST", "POST"],
  ])("a %i after %s continues as %s", (status, method, expected) => {
    const next = nextHop(hop(method), status, new URL("https://a.example/next"))

    expect(next.method).toBe(expected)
    expect(next.body === undefined).toBe(expected !== method)
    expect(next.headers.has("content-type")).toBe(expected === method)
  })

  it("keeps credentials on the same origin", () => {
    const next = nextHop(hop("GET"), 302, new URL("https://a.example/next"))

    expect(next.headers.get("authorization")).toBe("secret")
  })

  it("strips the given names across origins", () => {
    const next = nextHop(
      hop("GET"),
      302,
      new URL("https://b.example/"),
      new Set(["authorization", "x-api-key"]),
    )

    expect(next.headers.has("authorization")).toBe(false)
    expect(next.headers.has("x-api-key")).toBe(false)
  })

  it("strips the built-in names by default", () => {
    const next = nextHop(hop("GET"), 302, new URL("https://b.example/"))

    expect(next.headers.has("authorization")).toBe(false)
    expect(next.headers.get("x-api-key")).toBe("key")
  })
})
