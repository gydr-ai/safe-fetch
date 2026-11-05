import { BlockList } from "node:net"

import { BLOCKED_IPV4, BLOCKED_IPV6 } from "../constants/address-ranges.js"
import { embeddedIpv4 } from "../helpers/embedded-ipv4.js"
import { ipVersion, normalizeAddress } from "../helpers/ip.js"
import { ipv6Bytes } from "../helpers/ipv6-bytes.js"

const ipv4BlockList = new BlockList()
const ipv6BlockList = new BlockList()

for (const [network, prefix] of BLOCKED_IPV4) {
  ipv4BlockList.addSubnet(network, prefix, "ipv4")
}

for (const [network, prefix] of BLOCKED_IPV6) {
  ipv6BlockList.addSubnet(network, prefix, "ipv6")
}

/**
 * Judge an IPv6 literal: by its embedded IPv4 address when it carries one,
 * otherwise by the IPv6 list, and only ever allow global unicast.
 *
 * @param value - a normalised, valid IPv6 literal.
 * @returns `true` when the address must not be dialled.
 */
function isBlockedIpv6(value: string): boolean {
  const bytes = ipv6Bytes(value)
  const embedded = embeddedIpv4(bytes)

  if (embedded !== undefined) return ipv4BlockList.check(embedded, "ipv4")

  // Only global unicast (2000::/3) is ever dialled. Everything else is
  // reserved, local or unassigned, and some of it (ISATAP `::5efe:a.b.c.d`,
  // operator NAT64 prefixes) can carry an internal IPv4 address we cannot
  // recognise in general.
  if (((bytes[0] ?? 0) & 0xe0) !== 0x20) return true

  return ipv6BlockList.check(value, "ipv6")
}

/**
 * True when an IP literal must not be dialled: private, loopback,
 * link-local, metadata, reserved, documentation or multicast space, in
 * either family, including IPv4 hidden inside an IPv6 address (IPv4-mapped,
 * NAT64, 6to4).
 *
 * Anything that is not a valid IP literal returns `true` (fail closed), so a
 * hostname can never slip through as "not blocked".
 *
 * @param address - an IP literal; brackets and an interface zone are allowed.
 * @returns `true` when the address must be refused.
 * @example
 * ```ts
 * isBlockedAddress("169.254.169.254") // true (cloud metadata)
 * isBlockedAddress("::ffff:10.0.0.1") // true (private IPv4 inside IPv6)
 * isBlockedAddress("8.8.8.8") // false
 * isBlockedAddress("example.com") // true (not an IP literal)
 * ```
 */
export function isBlockedAddress(address: string): boolean {
  const value = normalizeAddress(address)
  const version = ipVersion(value)

  switch (version) {
    case 4:
      return ipv4BlockList.check(value, "ipv4")
    case 6:
      return isBlockedIpv6(value)
    case 0:
      return true
    default:
      return version satisfies never
  }
}
