import { describe, expect, it } from "vitest"

import { inList, toBlockList } from "../../src/helpers/cidr-list.js"

describe("toBlockList and inList", () => {
  const list = toBlockList(["10.0.0.0/8", "[fd00::]/8"], "blockedRanges")

  it("matches both families and ignores non-literals", () => {
    expect(inList(list, "10.1.2.3")).toBe(true)
    expect(inList(list, "fd12::1")).toBe(true)
    expect(inList(list, "11.0.0.1")).toBe(false)
    expect(inList(list, "example.com")).toBe(false)
  })

  it("names the option in the error", () => {
    expect(() => toBlockList(["10.0.0.0/"], "allowedRanges")).toThrow(
      "allowedRanges contains an invalid CIDR range: 10.0.0.0/",
    )
  })
})
