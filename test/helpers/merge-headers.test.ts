import { describe, expect, it } from "vitest"

import { mergeHeaders } from "../../src/helpers/merge-headers.js"

describe("mergeHeaders", () => {
  it("returns the call headers alone without defaults", () => {
    expect([...mergeHeaders(undefined, { a: "1" })]).toEqual([["a", "1"]])
    expect([...mergeHeaders(undefined, undefined)]).toEqual([])
  })

  it("replaces a default by name and keeps the rest", () => {
    const defaults = new Headers([
      ["accept", "a"],
      ["accept", "b"],
      ["user-agent", "default"],
    ])
    const merged = mergeHeaders(defaults, [["Accept", "c"]])

    expect([...merged]).toEqual([
      ["accept", "c"],
      ["user-agent", "default"],
    ])
    expect(defaults.get("accept")).toBe("a, b")
  })
})
