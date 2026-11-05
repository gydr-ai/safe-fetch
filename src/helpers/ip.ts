import { isIPv4, isIPv6 } from "node:net"

/**
 * Remove URL brackets and an interface zone (`[fe80::1%eth0]` → `fe80::1`)
 * and lower-case the result, so one address has one spelling.
 *
 * @param address - an IP literal or hostname, as found in a URL or DNS answer.
 * @returns the normalised value; a hostname is only lower-cased.
 * @internal
 */
export function normalizeAddress(address: string): string {
  const unbracketed =
    address.startsWith("[") && address.endsWith("]")
      ? address.slice(1, -1)
      : address
  const zone = unbracketed.indexOf("%")

  return (zone === -1 ? unbracketed : unbracketed.slice(0, zone)).toLowerCase()
}

/**
 * The IP version of a literal address.
 *
 * @param address - an IP literal (brackets and zone allowed) or a hostname.
 * @returns `4` or `6`, or `0` when the value is not an IP literal.
 * @internal
 */
export function ipVersion(address: string): 0 | 4 | 6 {
  const value = normalizeAddress(address)

  if (isIPv4(value)) return 4

  if (isIPv6(value)) return 6

  return 0
}
