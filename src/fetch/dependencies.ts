import { promises as dnsPromises } from "node:dns"

import { createAddressPolicy } from "../address/address-policy.js"
import { CROSS_ORIGIN_STRIPPED, HTTP_TOKEN } from "../constants/http.js"
import { compileHostnamePatterns } from "../helpers/hostname-patterns.js"
import { pickOptions } from "../helpers/options.js"
import { ownProperty } from "../helpers/own-property.js"
import type { HostnamePolicyOptions } from "../interfaces/hostname-policy-options.js"
import type {
  LookupResult,
  SafeFetchConfig,
} from "../interfaces/safe-fetch-config.js"
import type { SafeFetchDependencies } from "../interfaces/safe-fetch-dependencies.js"
import type { SafeFetchHooks } from "../interfaces/safe-fetch-hooks.js"
import { lazyKeepAlivePool, type KeepAlivePool } from "./keep-alive-pool.js"

/**
 * Resolve a hostname with the operating system resolver, returning every
 * address in the order the resolver gave them.
 *
 * @param hostname - the hostname to resolve.
 * @returns every address the hostname has.
 */
function systemLookup(hostname: string): Promise<readonly LookupResult[]> {
  return dnsPromises.lookup(hostname, { all: true, order: "verbatim" })
}

/**
 * Combine `blockedHostnames` and `allowedHostnames` into one predicate.
 *
 * @param options - the hostname rules.
 * @returns a function that returns `true` for a refused hostname, or
 *   `undefined` when no rule is configured.
 * @throws {TypeError} when a pattern is malformed.
 */
function hostnamePolicy(
  options: HostnamePolicyOptions,
): ((hostname: string) => boolean) | undefined {
  const blockedPatterns = ownProperty(options, "blockedHostnames")
  const allowedPatterns = ownProperty(options, "allowedHostnames")
  const blocked =
    blockedPatterns === undefined
      ? undefined
      : compileHostnamePatterns(blockedPatterns, "blockedHostnames")
  const allowed =
    allowedPatterns === undefined
      ? undefined
      : compileHostnamePatterns(allowedPatterns, "allowedHostnames")

  if (blocked === undefined && allowed === undefined) return undefined

  return (hostname) =>
    blocked?.(hostname) === true ||
    (allowed !== undefined && !allowed(hostname))
}

/**
 * The header names dropped on a cross-origin redirect: always the built-in
 * set, plus any extra names, lower-cased.
 *
 * @param extra - the caller's extra names.
 * @returns the full set.
 * @throws {TypeError} when a name is not a valid header name.
 */
function crossOriginStripped(extra: readonly string[]): ReadonlySet<string> {
  const names = new Set(CROSS_ORIGIN_STRIPPED)

  for (const name of extra) {
    if (!HTTP_TOKEN.test(name)) {
      throw new TypeError(
        `stripHeadersOnCrossOrigin contains an invalid header name: ${name}`,
      )
    }

    names.add(name.toLowerCase())
  }

  return names
}

/**
 * Copy the hooks, keeping only functions the configuration holds as its own
 * properties, so later changes to the object (or to `Object.prototype`)
 * cannot add or swap a hook. The result has a `null` prototype.
 *
 * @param config - the caller's configuration.
 * @returns the hooks.
 * @throws {TypeError} when a hook is set to something other than a function.
 */
function hooksOf(config: SafeFetchHooks): SafeFetchHooks {
  const hooks: SafeFetchHooks = Object.create(null) as SafeFetchHooks

  for (const name of [
    "onResolve",
    "onRedirect",
    "onRequest",
    "onResponse",
  ] as const) {
    const hook: unknown = ownProperty(config, name)

    switch (typeof hook) {
      case "undefined":
        break
      case "function":
        Object.assign(hooks, { [name]: hook })
        break
      case "bigint":
      case "boolean":
      case "number":
      case "object":
      case "string":
      case "symbol":
      default:
        throw new TypeError(`${name} must be a function`)
    }
  }

  return Object.freeze(hooks)
}

/**
 * The instance's connection pool when `keepAlive` is set.
 *
 * @param config - the instance configuration.
 * @returns a lazy pool getter, or `undefined` for a new connection per request.
 * @throws {TypeError} when `keepAlive` is not a boolean.
 */
function poolOf(config: SafeFetchConfig): (() => KeepAlivePool) | undefined {
  const keepAlive: unknown = ownProperty(config, "keepAlive")

  switch (keepAlive) {
    case undefined:
    case false:
      return undefined
    case true:
      return lazyKeepAlivePool()
    default:
      throw new TypeError("keepAlive must be a boolean")
  }
}

/**
 * Validate a public configuration and turn it into what a `safeFetch`
 * instance runs with. Everything is copied, so changing the configuration
 * object afterwards has no effect, and only the object's own properties are
 * read, so a polluted `Object.prototype` cannot configure anything.
 *
 * @param config - the caller's configuration.
 * @returns the dependencies.
 * @throws {TypeError} when a range, hostname pattern, header, hook or
 *   option is invalid.
 * @internal
 */
export function dependenciesFor(
  config: SafeFetchConfig,
): SafeFetchDependencies {
  const headers = ownProperty(config, "headers")

  return {
    lookup: ownProperty(config, "lookup") ?? systemLookup,
    isBlockedAddress: createAddressPolicy(config),
    isRefusedHostname: hostnamePolicy(config),
    defaults: pickOptions(config),
    headers: headers === undefined ? undefined : new Headers(headers),
    crossOriginStripped: crossOriginStripped(
      ownProperty(config, "stripHeadersOnCrossOrigin") ?? [],
    ),
    hooks: hooksOf(config),
    pool: poolOf(config),
  }
}

/**
 * The dependencies of the plain `safeFetch` and `resolveSafeUrl`: the
 * system resolver, the built-in policies and no hooks.
 *
 * @internal
 */
export const defaultDependencies: SafeFetchDependencies = dependenciesFor({})
