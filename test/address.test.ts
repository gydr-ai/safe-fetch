import { describe, expect, it } from "vitest"

import {
  createAddressPolicy,
  ipVersion,
  isBlockedAddress,
} from "../src/address.js"

describe("isBlockedAddress", () => {
  it.each([
    // IPv4 special-purpose space
    "0.0.0.0",
    "0.255.255.255",
    "10.0.0.1",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    // IPv6 special-purpose space
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "[::1]",
    "::7f00:1", // IPv4-compatible 127.0.0.1
    "::8.8.8.8", // IPv4-compatible is deprecated, always refused
    "::ffff:0:a00:1", // IPv4-translated
    "64:ff9b:1::1", // local-use NAT64
    "100::1",
    "2001::1", // Teredo
    "2001:db8::1",
    "3fff::1",
    "5f00::1",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "fe80::1%eth0",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "::5efe:7f00:1", // ISATAP, outside global unicast
    "4000::1", // unassigned
    "1::1",
    // IPv4 hidden inside IPv6
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::FFFF:A00:1",
    "[::ffff:10.0.0.1]",
    "64:ff9b::a9fe:a9fe", // NAT64 → 169.254.169.254
    "64:ff9b::10.0.0.1",
    "2002:a9fe:a9fe::1", // 6to4 → 169.254.169.254
    "2002:7f00:1::",
    "2002:c0a8:101::1", // 6to4 → 192.168.1.1
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.215.14",
    "100.63.255.255", // just below CGNAT
    "100.128.0.0", // just above CGNAT
    "172.15.255.255",
    "172.32.0.0",
    "198.17.255.255",
    "198.20.0.0",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "2a00:1450:4001:82a::200e",
    "::ffff:8.8.8.8", // mapped public IPv4
    "64:ff9b::808:808", // NAT64 → 8.8.8.8
    "2002:808:808::1", // 6to4 → 8.8.8.8
  ])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false)
  })

  it.each(["example.com", "", "256.0.0.1", "1.2.3", "::g"])(
    "fails closed on the non-address %j",
    (value) => {
      expect(isBlockedAddress(value)).toBe(true)
    },
  )
})

describe("ipVersion", () => {
  it("names the family of a literal", () => {
    expect(ipVersion("1.2.3.4")).toBe(4)
    expect(ipVersion("[::1]")).toBe(6)
    expect(ipVersion("example.com")).toBe(0)
  })
})

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
