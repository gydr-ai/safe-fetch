import { describe, expect, it } from "vitest"

import { compileHostnamePatterns } from "../../src/helpers/hostname-patterns.js"

describe("compileHostnamePatterns", () => {
  const matches = compileHostnamePatterns(
    ["API.example.com.", "*.cdn.example"],
    "blockedHostnames",
  )

  it.each([
    "api.example.com",
    "api.example.com.",
    "a.cdn.example",
    "a.b.cdn.example",
  ])("matches %s", (host) => {
    expect(matches(host)).toBe(true)
  })

  it.each([
    "example.com",
    "x.api.example.com",
    "cdn.example",
    "evilcdn.example",
  ])("does not match %s", (host) => {
    expect(matches(host)).toBe(false)
  })

  it("names the option in the error", () => {
    expect(() => compileHostnamePatterns(["a b"], "allowedHostnames")).toThrow(
      "allowedHostnames contains an invalid hostname: a b",
    )
  })
})

describe("compileHostnamePatterns with international and odd names", () => {
  it("matches a Unicode pattern against the punycode a URL carries", () => {
    const matches = compileHostnamePatterns(
      ["bücher.example", "*.münchen.example"],
      "blockedHostnames",
    )

    expect(matches(new URL("https://bücher.example/").hostname)).toBe(true)
    expect(matches("xn--bcher-kva.example")).toBe(true)
    expect(matches(new URL("https://a.münchen.example/").hostname)).toBe(true)
  })

  it("accepts an exact IP literal", () => {
    expect(compileHostnamePatterns(["[::1]"], "x")("::1")).toBe(true)
  })

  it.each(["a..b", "*.a..b", "*.10.0.0.1", "x?y", "a:b"])(
    "rejects %j",
    (pattern) => {
      expect(() => compileHostnamePatterns([pattern], "x")).toThrow(TypeError)
    },
  )
})
