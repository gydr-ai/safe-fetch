/**
 * IPv4 ranges that must never be dialled from a server that fetches
 * user-supplied URLs, as `[network, prefix length]` pairs.
 *
 * Source: the IANA IPv4 Special-Purpose Address Registry, restricted to
 * ranges that are not globally reachable, plus multicast and the reserved
 * 240/4 block.
 *
 * @internal
 */
export const BLOCKED_IPV4: ReadonlyArray<readonly [string, number]> = [
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
 * IPv6 ranges that are blocked outright, as `[network, prefix length]` pairs.
 *
 * Prefixes that EMBED an IPv4 address (IPv4-mapped, NAT64, 6to4) are not
 * listed here: they are unwrapped and the embedded address is judged by
 * {@link BLOCKED_IPV4}, so a public IPv4 reached through NAT64 still works
 * while a private one never does.
 *
 * @internal
 */
export const BLOCKED_IPV6: ReadonlyArray<readonly [string, number]> = [
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
