import { describe, expect, it } from "vitest"

import { createAddressPolicy } from "../../src/address/address-policy.js"
import { isBlockedAddress } from "../../src/address/is-blocked-address.js"

describe("createAddressPolicy", () => {
  it("adds blocked ranges and carves out allowed ones", () => {
    const policy = createAddressPolicy({
      blockedRanges: ["8.8.8.0/24", "2606:4700::/32"],
      allowedRanges: ["10.20.0.0/16"],
    })

    expect(policy("8.8.8.8")).toBe(true)
    expect(policy("2606:4700:4700::1111")).toBe(true)
    expect(policy("10.20.1.1")).toBe(false)
    expect(policy("::ffff:10.20.1.1")).toBe(false)
    expect(policy("10.21.0.1")).toBe(true)
    expect(policy("1.1.1.1")).toBe(false)
  })

  it("lets a blocked range win over an allowed one", () => {
    const policy = createAddressPolicy({
      blockedRanges: ["10.20.5.0/24"],
      allowedRanges: ["10.20.0.0/16"],
    })

    expect(policy("10.20.5.9")).toBe(true)
  })

  it("matches the built-in policy with no options", () => {
    const policy = createAddressPolicy()

    for (const address of ["127.0.0.1", "8.8.8.8", "::1", "2606:4700::1"]) {
      expect(policy(address)).toBe(isBlockedAddress(address))
    }
  })
})

describe("createAddressPolicy with IPv4 carried inside IPv6", () => {
  const policy = createAddressPolicy({
    blockedRanges: ["8.8.8.0/24"],
    allowedRanges: ["10.20.0.0/16"],
  })

  it.each([
    "::ffff:8.8.8.8",
    "::ffff:808:808",
    "64:ff9b::808:808", // NAT64
    "64:ff9b::8.8.8.8",
    "2002:808:808::1", // 6to4
  ])("applies blockedRanges to %s", (address) => {
    expect(policy(address)).toBe(true)
  })

  it.each(["64:ff9b::a14:101", "2002:a14:101::1"])(
    "applies allowedRanges to %s",
    (address) => {
      expect(policy(address)).toBe(false)
    },
  )
})

describe("createAddressPolicy and a polluted prototype", () => {
  it("never reads inherited ranges", () => {
    const proto = Object.prototype as Record<string, unknown>

    proto.allowedRanges = ["0.0.0.0/0"]

    try {
      expect(createAddressPolicy({})("10.0.0.1")).toBe(true)
    } finally {
      delete proto.allowedRanges
    }
  })
})
