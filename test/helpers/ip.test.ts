import { describe, expect, it } from "vitest"

import { ipVersion } from "../../src/helpers/ip.js"

describe("ipVersion", () => {
  it("names the family of a literal", () => {
    expect(ipVersion("1.2.3.4")).toBe(4)
    expect(ipVersion("[::1]")).toBe(6)
    expect(ipVersion("example.com")).toBe(0)
  })
})
