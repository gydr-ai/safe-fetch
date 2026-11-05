import { describe, expect, it } from "vitest"

import { mergeOptions, pickOptions } from "../../src/helpers/options.js"
import type { SafeFetchConfig } from "../../src/interfaces/safe-fetch-config.js"
import type { SafeFetchOptions } from "../../src/interfaces/safe-fetch-options.js"

describe("pickOptions", () => {
  it("keeps only set option fields and freezes a copy of the ports", () => {
    const ports = [443]
    // A JavaScript caller can pass an explicit undefined.
    const config = {
      allowedPorts: ports,
      timeoutMs: 10,
      label: undefined,
      blockedRanges: ["10.0.0.0/8"],
    } as unknown as SafeFetchConfig
    const picked = pickOptions(config)

    ports.push(80)
    expect(picked).toEqual({ allowedPorts: [443], timeoutMs: 10 })
    expect(Object.isFrozen(picked.allowedPorts)).toBe(true)
  })
})

describe("mergeOptions", () => {
  it("lets a set call option win and an unset one fall back", () => {
    expect(
      mergeOptions({ timeoutMs: 10, allowHttp: true }, {
        timeoutMs: 20,
        allowHttp: undefined,
      } as unknown as SafeFetchOptions),
    ).toEqual({ timeoutMs: 20, allowHttp: true })
  })
})

describe("pickOptions validation", () => {
  it.each([
    ["maxResponseBytes", Number.NaN],
    ["maxResponseBytes", Number.POSITIVE_INFINITY],
    ["maxResponseBytes", "1024"],
    ["maxResponseBytes", -1],
    ["maxResponseBytes", 1.5],
    ["maxLength", Number.NaN],
    ["maxRedirects", Number.NaN],
    ["timeoutMs", Number.NaN],
    ["timeoutMs", Number.POSITIVE_INFINITY],
    ["timeoutMs", 0],
    ["timeoutMs", 2 ** 31],
    ["allowHttp", "yes"],
    ["decompress", 0],
    ["label", 42],
    ["allowedPorts", 443],
    ["allowedPorts", [0]],
    ["allowedPorts", [65_536]],
    ["allowedPorts", ["443"]],
  ])("rejects %s = %j", (key, value) => {
    expect(() => pickOptions({ [key]: value })).toThrow(TypeError)
  })

  it("accepts the edges of each range", () => {
    expect(
      pickOptions({
        timeoutMs: 2 ** 31 - 1,
        maxRedirects: 0,
        allowedPorts: [1, 65_535],
      }),
    ).toEqual({
      timeoutMs: 2 ** 31 - 1,
      maxRedirects: 0,
      allowedPorts: [1, 65_535],
    })
  })

  it("reads only own properties and returns a null-prototype object", () => {
    const proto = Object.prototype as Record<string, unknown>

    proto.maxResponseBytes = Number.POSITIVE_INFINITY

    try {
      const picked = pickOptions({})

      expect(Object.getPrototypeOf(picked)).toBeNull()
      expect(picked.maxResponseBytes).toBeUndefined()
      expect(mergeOptions(picked, {}).maxResponseBytes).toBeUndefined()
    } finally {
      delete proto.maxResponseBytes
    }
  })
})
