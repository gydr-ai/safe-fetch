import { describe, expect, it } from "vitest"

import { normalizeMethod } from "../../src/helpers/normalize-method.js"

describe("normalizeMethod", () => {
  it.each([
    [undefined, "GET"],
    ["post", "POST"],
    ["Options", "OPTIONS"],
    ["patch", "patch"],
    ["PROPFIND", "PROPFIND"],
  ])("turns %j into %s", (input, expected) => {
    expect(normalizeMethod(input)).toBe(expected)
  })

  it.each(["connect", "TRACE", "track", "", "G T", "GET\r\n"])(
    "refuses %j",
    (method) => {
      expect(() => normalizeMethod(method)).toThrow(
        expect.objectContaining({ code: "unsupported_method" }),
      )
    },
  )
})
