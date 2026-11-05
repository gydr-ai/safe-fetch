/**
 * Format four bytes as a dotted-quad IPv4 address.
 *
 * @param bytes - the IPv6 address bytes.
 * @param offset - index of the first IPv4 byte.
 * @returns the dotted-quad address.
 */
function ipv4From(bytes: Uint8Array, offset: number): string {
  return Array.from(bytes.subarray(offset, offset + 4)).join(".")
}

/**
 * Whether every byte in `[from, to)` is zero.
 *
 * @param bytes - the bytes to inspect.
 * @param from - first index, inclusive.
 * @param to - last index, exclusive.
 * @returns `true` when the whole span is zero.
 */
function isZero(bytes: Uint8Array, from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    if (bytes[index] !== 0) return false
  }

  return true
}

/**
 * The IPv4 address an IPv6 address carries and routes to, if it has one:
 * IPv4-mapped (`::ffff:0:0/96`, RFC 4291 § 2.5.5.2), well-known NAT64
 * (`64:ff9b::/96`, RFC 6052) and 6to4 (`2002::/16`, RFC 3056).
 *
 * Such an address is judged by its IPv4 part, because that is where the
 * packets end up.
 *
 * @param bytes - the 16 bytes of an IPv6 address.
 * @returns the embedded dotted-quad address, or `undefined` for none.
 * @internal
 */
export function embeddedIpv4(bytes: Uint8Array): string | undefined {
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
