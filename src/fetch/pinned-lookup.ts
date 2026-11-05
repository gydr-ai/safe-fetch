import type { LookupFunction } from "node:net"

import { normalizeAddress } from "../helpers/ip.js"
import type { ResolvedAddress } from "../interfaces/resolved-address.js"

/**
 * A socket `lookup` that only ever answers with the addresses already
 * vetted, so the connection dials exactly what was checked and a second DNS
 * answer (DNS rebinding) can never redirect it.
 *
 * It refuses any hostname other than the one that was resolved, and honours
 * a requested family by filtering the vetted set, never by resolving again.
 *
 * @param expectedHost - the normalised hostname the addresses belong to.
 * @param addresses - the vetted addresses.
 * @returns a `lookup` function for `http.request`.
 * @internal
 */
export function pinnedLookup(
  expectedHost: string,
  addresses: readonly ResolvedAddress[],
): LookupFunction {
  return (hostname, options, callback) => {
    if (normalizeAddress(hostname) !== expectedHost) {
      callback(new Error("Resolution target changed mid-request"), "", 4)

      return
    }

    let wanted: readonly ResolvedAddress[]

    switch (options.family) {
      case 4:
      case 6:
        wanted = addresses.filter((entry) => entry.family === options.family)
        break
      // Only a numeric family narrows the set; anything else gets them all.
      case "IPv4":
      case "IPv6":
      case undefined:
      default:
        wanted = addresses
    }

    if (options.all === true) {
      callback(
        null,
        wanted.map((entry) => ({
          address: entry.address,
          family: entry.family,
        })),
      )

      return
    }

    const first = wanted[0]

    if (first === undefined) {
      callback(new Error("No address of the requested family"), "", 4)

      return
    }

    callback(null, first.address, first.family)
  }
}
