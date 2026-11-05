import { describe, expect, it } from "vitest"

import { portOf } from "../../src/helpers/port-of.js"

describe("portOf", () => {
  it.each([
    ["https://example.com", 443],
    ["http://example.com", 80],
    ["https://example.com:8443", 8443],
    ["http://example.com:443", 443],
  ])("dials %s on port %i", (url, port) => {
    expect(portOf(new URL(url))).toBe(port)
  })
})
