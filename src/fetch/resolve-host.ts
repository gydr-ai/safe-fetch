import {
  SafeFetchError,
  SafeFetchErrorCode,
} from "../errors/safe-fetch-error.js"
import { UnsafeUrlError, UnsafeUrlReason } from "../errors/unsafe-url-error.js"
import { runDecisionHook, frozenAddresses } from "../helpers/hooks.js"
import { ipVersion, normalizeAddress } from "../helpers/ip.js"
import type { ResolvedAddress } from "../interfaces/resolved-address.js"
import type { SafeFetchDependencies } from "../interfaces/safe-fetch-dependencies.js"

/**
 * Copy a resolver's answer into plain records, reading each field exactly
 * once. The policy check and the socket pin then use this one copy, so an
 * answer whose `address` is a getter (or an array whose methods are
 * overridden) cannot show one address to the check and another to the
 * connection.
 *
 * @param answer - whatever the `lookup` function resolved with.
 * @returns the records, with `address` a string and `family` a number.
 * @throws {Error} when the answer is not an array of records with a string
 *   `address`, or reading it throws.
 */
function snapshotRecords(
  answer: unknown,
): Array<{ address: string; family: number }> {
  if (!Array.isArray(answer)) throw new Error("lookup did not return an array")

  return Array.from(answer as unknown[], (record: unknown) => {
    if (typeof record !== "object" || record === null) {
      throw new Error("lookup returned a record that is not an object")
    }

    const address: unknown = Reflect.get(record, "address")
    const family: unknown = Reflect.get(record, "family")

    if (typeof address !== "string") {
      throw new Error("lookup returned an address that is not a string")
    }

    return { address, family: Number(family) }
  })
}

/**
 * Look a hostname up and vet every address it returns.
 *
 * Failing closed on the whole set matters: a DNS-rebinding answer often
 * mixes one public and one private address, and happy-eyeballs may dial
 * either. An IP literal is returned as is; it was already judged by the URL
 * check. The answer is copied once ({@link snapshotRecords}) and only that
 * copy is checked and returned for pinning.
 *
 * @param hostname - a normalised hostname or IP literal.
 * @param label - the URL's name in error messages.
 * @param dependencies - the resolver and address policy.
 * @returns every resolved address, normalised.
 * @throws {SafeFetchError} `DNS_FAILURE` when nothing resolves, or the
 *   resolver's answer is malformed.
 * @throws {UnsafeUrlError} `BLOCKED_ADDRESS` when any address is blocked.
 */
async function lookupAndVet(
  hostname: string,
  label: string,
  dependencies: SafeFetchDependencies,
): Promise<ResolvedAddress[]> {
  const version = ipVersion(hostname)

  if (version !== 0) return [{ address: hostname, family: version }]

  let records: Array<{ address: string; family: number }>

  try {
    records = snapshotRecords(await dependencies.lookup(hostname))
  } catch (error) {
    throw new SafeFetchError(
      SafeFetchErrorCode.DNS_FAILURE,
      `${label} has no resolvable address`,
      { cause: error },
    )
  }

  if (records.length === 0) {
    throw new SafeFetchError(
      SafeFetchErrorCode.DNS_FAILURE,
      `${label} has no resolvable address`,
    )
  }

  for (const record of records) {
    if (dependencies.isBlockedAddress(record.address)) {
      throw new UnsafeUrlError(
        UnsafeUrlReason.BLOCKED_ADDRESS,
        `${label} targets a blocked host or address range`,
      )
    }
  }

  // The family is derived from the address itself, never trusted from the
  // resolver, so the pin can never pair an address with the wrong family.
  return records.map((record) => {
    const address = normalizeAddress(record.address)

    return { address, family: ipVersion(address) === 6 ? 6 : 4 }
  })
}

/**
 * Resolve a host to the addresses the connection may use, refusing the
 * whole host if ANY address it resolves to is blocked, then giving the
 * `onResolve` hook (if any) a frozen copy so it can refuse more.
 *
 * @param hostname - a normalised hostname or IP literal.
 * @param label - the URL's name in error messages.
 * @param dependencies - the resolver, address policy and hooks.
 * @returns every resolved address, normalised.
 * @throws {SafeFetchError} `DNS_FAILURE` when nothing resolves, or
 *   `HOOK_FAILED` when the hook fails.
 * @throws {UnsafeUrlError} `BLOCKED_ADDRESS` when any address is blocked or
 *   the hook refuses the host.
 * @internal
 */
export async function resolveHost(
  hostname: string,
  label: string,
  dependencies: SafeFetchDependencies,
): Promise<ResolvedAddress[]> {
  const addresses = await lookupAndVet(hostname, label, dependencies)
  const allowed = runDecisionHook(
    "onResolve",
    dependencies.hooks.onResolve,
    Object.freeze({ hostname, addresses: frozenAddresses(addresses) }),
  )

  if (!allowed) {
    throw new UnsafeUrlError(
      UnsafeUrlReason.BLOCKED_ADDRESS,
      `${label} targets a blocked host or address range`,
    )
  }

  return addresses
}
