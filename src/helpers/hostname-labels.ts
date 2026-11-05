/**
 * Whether a hostname has an empty label (`a..b`, `.a`, or more than one
 * trailing dot). One trailing dot is the fully qualified form and is
 * allowed. Such a name is refused outright: it is never a real host, and it
 * would otherwise compare unequal to the hostname rules it is meant to hit.
 *
 * @param hostname - a lower-cased hostname (not an IP literal).
 * @returns `true` when a label is empty.
 * @internal
 */
export function hasEmptyLabel(hostname: string): boolean {
  const name = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname

  return name.split(".").some((label) => label === "")
}
