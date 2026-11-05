import { BlockList, isIPv4, isIPv6 } from "node:net"

/**
 * IPv4 ranges that must never be dialled from a server that fetches
 * user-supplied URLs. Source: the IANA IPv4 Special-Purpose Address Registry,
 * restricted to ranges that are not globally reachable, plus multicast and
 * the reserved 240/4 block.
 */
const BLOCKED_IPV4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"; 0.0.0.0 reaches the local host on Linux
  ["10.0.0.0", 8], // RFC 1918 private
  ["100.64.0.0", 10], // RFC 6598 shared address space (CGNAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // RFC 1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // deprecated 6to4 relay anycast
  ["192.168.0.0", 16], // RFC 1918 private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. limited broadcast 255.255.255.255
]

/**
 * IPv6 ranges that are blocked outright. Prefixes that EMBED an IPv4 address
 * (IPv4-mapped, NAT64, 6to4) are not listed here: they are unwrapped and the
 * embedded address is judged by the IPv4 list, so a public IPv4 reached
 * through NAT64 still works while a private one never does.
 */
const BLOCKED_IPV6: ReadonlyArray<readonly [string, number]> = [
  ["::", 96], // unspecified, loopback and deprecated IPv4-compatible (::a.b.c.d)
  ["::ffff:0:0:0", 96], // IPv4-translated (SIIT)
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard-only
  ["2001::", 23], // IETF protocol assignments, incl. Teredo 2001::/32
  ["2001:db8::", 32], // documentation
  ["3fff::", 20], // documentation (RFC 9637)
  ["5f00::", 16], // SRv6 SIDs
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // deprecated site-local
  ["ff00::", 8], // multicast
]

const ipv4BlockList = new BlockList()
const ipv6BlockList = new BlockList()

for (const [network, prefix] of BLOCKED_IPV4) {
  ipv4BlockList.addSubnet(network, prefix, "ipv4")
}

for (const [network, prefix] of BLOCKED_IPV6) {
  ipv6BlockList.addSubnet(network, prefix, "ipv6")
}

/** Remove URL brackets and an interface zone (`fe80::1%eth0`). */
export function normalizeAddress(address: string): string {
  const unbracketed =
    address.startsWith("[") && address.endsWith("]")
      ? address.slice(1, -1)
      : address
  const zone = unbracketed.indexOf("%")

  return (zone === -1 ? unbracketed : unbracketed.slice(0, zone)).toLowerCase()
}

/** The IP version of a literal address, or 0 when it is not an IP literal. */
export function ipVersion(address: string): 0 | 4 | 6 {
  const value = normalizeAddress(address)

  if (isIPv4(value)) return 4

  if (isIPv6(value)) return 6

  return 0
}

/** Expand a valid IPv6 literal into its 16 bytes. */
function ipv6Bytes(address: string): Uint8Array {
  const bytes = new Uint8Array(16)
  let text = address
  const tail: number[] = []

  // A trailing dotted quad (::ffff:1.2.3.4) is two 16-bit groups.
  const lastColon = text.lastIndexOf(":")
  const lastGroup = text.slice(lastColon + 1)

  if (lastGroup.includes(".")) {
    for (const octet of lastGroup.split(".")) tail.push(Number(octet))
    text = `${text.slice(0, lastColon + 1)}0:0`
  }

  const [head = "", rest] = text.split("::")
  const headGroups = head === "" ? [] : head.split(":")
  const restGroups = rest === undefined || rest === "" ? [] : rest.split(":")
  const missing = 8 - headGroups.length - restGroups.length
  const groups =
    rest === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(missing).fill("0"), ...restGroups]

  groups.forEach((group, index) => {
    const value = Number.parseInt(group, 16)

    bytes[index * 2] = value >> 8
    bytes[index * 2 + 1] = value & 0xff
  })

  if (tail.length === 4) bytes.set(tail, 12)

  return bytes
}

function ipv4From(bytes: Uint8Array, offset: number): string {
  return Array.from(bytes.subarray(offset, offset + 4)).join(".")
}

function isZero(bytes: Uint8Array, from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    if (bytes[index] !== 0) return false
  }

  return true
}

/**
 * The IPv4 address an IPv6 address carries and routes to, if it has one:
 * IPv4-mapped (`::ffff:0:0/96`), well-known NAT64 (`64:ff9b::/96`, RFC 6052)
 * and 6to4 (`2002::/16`, RFC 3056).
 */
function embeddedIpv4(bytes: Uint8Array): string | undefined {
  if (isZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return ipv4From(bytes, 12)
  }

  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    isZero(bytes, 4, 12)
  ) {
    return ipv4From(bytes, 12)
  }

  if (bytes[0] === 0x20 && bytes[1] === 0x02) return ipv4From(bytes, 2)

  return undefined
}

/**
 * True when an IP literal must not be dialled: private, loopback,
 * link-local, metadata, reserved, documentation or multicast space, in
 * either family, including IPv4 hidden inside an IPv6 address.
 *
 * Anything that is not a valid IP literal returns `true` (fail closed).
 */
export function isBlockedAddress(address: string): boolean {
  const value = normalizeAddress(address)

  if (isIPv4(value)) return ipv4BlockList.check(value, "ipv4")

  if (!isIPv6(value)) return true

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

/** Extra ranges for {@link createAddressPolicy}, in CIDR notation. */
export interface AddressPolicyOptions {
  /** Ranges refused in addition to the built-in list, e.g. `["203.0.113.0/24"]`. */
  blockedRanges?: readonly string[]
  /**
   * Ranges permitted even though the built-in list refuses them, e.g.
   * `["10.20.0.0/16"]` for a crawler that must reach one internal network.
   * This weakens SSRF protection on purpose: list the narrowest ranges you
   * can, and never a range that contains a metadata service.
   */
  allowedRanges?: readonly string[]
}

function toBlockList(ranges: readonly string[], option: string): BlockList {
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

function inList(list: BlockList, address: string): boolean {
  const value = normalizeAddress(address)
  const version = ipVersion(value)

  if (version === 0) return false

  return list.check(value, version === 6 ? "ipv6" : "ipv4")
}

/**
 * Build an address policy: the built-in list, plus `blockedRanges`, minus
 * `allowedRanges`. Returns `true` for an address that must be refused.
 *
 * @throws {TypeError} when a range is not valid CIDR notation.
 */
export function createAddressPolicy(
  options: AddressPolicyOptions = {},
): (address: string) => boolean {
  const blocked = toBlockList(options.blockedRanges ?? [], "blockedRanges")
  const allowed = toBlockList(options.allowedRanges ?? [], "allowedRanges")

  return (address) => {
    if (inList(blocked, address)) return true

    if (inList(allowed, address)) return false

    return isBlockedAddress(address)
  }
}
