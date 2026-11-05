import { BlockList } from "node:net"

import { embeddedIpv4 } from "./embedded-ipv4.js"
import { ipVersion, normalizeAddress } from "./ip.js"
import { ipv6Bytes } from "./ipv6-bytes.js"

/**
 * Parse CIDR ranges (`"10.0.0.0/8"`, `"fc00::/7"`) into a `BlockList`.
 *
 * The prefix must be written in plain decimal digits and must fit the
 * family, so a typo can never silently widen or narrow a range.
 *
 * @param ranges - ranges in CIDR notation.
 * @param option - the option name, used in the error message.
 * @returns a `BlockList` holding every range.
 * @throws {TypeError} when a range is not valid CIDR notation.
 * @internal
 */
export function toBlockList(
  ranges: readonly string[],
  option: string,
): BlockList {
  const list = new BlockList()

  for (const range of ranges) {
    const [network = "", prefixText = "", extra] = range.split("/")
    const version = ipVersion(network)
    const prefix = Number(prefixText)
    const maxPrefix = version === 6 ? 128 : 32

    if (
      extra !== undefined ||
      version === 0 ||
      !/^\d{1,3}$/.test(prefixText) ||
      prefix > maxPrefix
    ) {
      throw new TypeError(`${option} contains an invalid CIDR range: ${range}`)
    }

    list.addSubnet(
      normalizeAddress(network),
      prefix,
      version === 6 ? "ipv6" : "ipv4",
    )
  }

  return list
}

/**
 * Whether an IP literal falls inside a `BlockList`. An IPv6 address that
 * carries an IPv4 address (IPv4-mapped, NAT64, 6to4) also matches when the
 * IPv4 address it routes to is in the list, the same rule
 * `isBlockedAddress` applies.
 *
 * @param list - the ranges to test against.
 * @param address - the address to test.
 * @returns `true` when the address is in a range; `false` for a non-literal.
 * @internal
 */
export function inList(list: BlockList, address: string): boolean {
  const value = normalizeAddress(address)
  const version = ipVersion(value)

  switch (version) {
    case 0:
      return false
    case 4:
      return list.check(value, "ipv4")
    case 6: {
      const embedded = embeddedIpv4(ipv6Bytes(value))

      return (
        list.check(value, "ipv6") ||
        (embedded !== undefined && list.check(embedded, "ipv4"))
      )
    }
    default:
      return version satisfies never
  }
}
