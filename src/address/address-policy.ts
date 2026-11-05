import { inList, toBlockList } from "../helpers/cidr-list.js"
import { ownProperty } from "../helpers/own-property.js"
import type { AddressPolicyOptions } from "../interfaces/address-policy-options.js"
import { isBlockedAddress } from "./is-blocked-address.js"

/**
 * Build an address policy: the built-in list, plus `blockedRanges`, minus
 * `allowedRanges`. A blocked range wins over an allowed one, and an address
 * in neither falls back to {@link isBlockedAddress}. An IPv6 address that
 * carries an IPv4 address (IPv4-mapped, NAT64, 6to4) is matched by the IPv4
 * address too. Only the object's own properties are read.
 *
 * @param options - extra ranges to refuse or permit.
 * @returns a function that returns `true` for an address that must be refused.
 * @throws {TypeError} when a range is not valid CIDR notation.
 * @example
 * ```ts
 * const isBlocked = createAddressPolicy({
 *   blockedRanges: ["203.0.113.0/24"],
 *   allowedRanges: ["10.20.0.0/16"],
 * })
 *
 * isBlocked("10.20.1.1") // false (explicitly allowed)
 * isBlocked("10.21.0.1") // true (still private)
 * ```
 */
export function createAddressPolicy(
  options: AddressPolicyOptions = {},
): (address: string) => boolean {
  const blocked = toBlockList(
    ownProperty(options, "blockedRanges") ?? [],
    "blockedRanges",
  )
  const allowed = toBlockList(
    ownProperty(options, "allowedRanges") ?? [],
    "allowedRanges",
  )

  return (address) => {
    if (inList(blocked, address)) return true

    if (inList(allowed, address)) return false

    return isBlockedAddress(address)
  }
}
