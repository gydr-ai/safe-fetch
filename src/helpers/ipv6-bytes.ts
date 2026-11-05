/**
 * Expand a valid IPv6 literal into its 16 bytes, including the trailing
 * dotted-quad form (`::ffff:1.2.3.4`).
 *
 * The input must already be a valid, normalised IPv6 literal: this does no
 * validation of its own.
 *
 * @param address - a valid IPv6 literal without brackets or zone.
 * @returns the 16 address bytes in network order.
 * @internal
 */
export function ipv6Bytes(address: string): Uint8Array {
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
