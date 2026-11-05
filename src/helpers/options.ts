import type { SafeFetchOptions } from "../interfaces/safe-fetch-options.js"
import { ownProperty } from "./own-property.js"

/**
 * Largest `timeoutMs` accepted: the longest delay a Node.js timer supports
 * (2^31 - 1 ms, about 24.8 days).
 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1

/** Largest TCP port number. */
const MAX_PORT = 65_535

/**
 * Every per-call option name. Typed so that a new option cannot be added
 * without listing (and therefore validating) it here.
 */
const OPTION_KEYS = [
  "allowHttp",
  "allowedPorts",
  "decompress",
  "label",
  "maxLength",
  "maxRedirects",
  "maxResponseBytes",
  "timeoutMs",
] as const satisfies ReadonlyArray<keyof SafeFetchOptions>

/** One of {@link OPTION_KEYS}. */
type OptionKey = (typeof OPTION_KEYS)[number]

/**
 * The error for an option set to a value it cannot take.
 *
 * @param key - the option name.
 * @param expected - what the option must be, for the message.
 * @returns the error to throw.
 */
function invalid(key: OptionKey, expected: string): TypeError {
  return new TypeError(`${key} must be ${expected}`)
}

/**
 * Whether a value is an integer in `[min, max]`. `NaN`, infinities,
 * fractions and non-numbers (including numeric strings) are not.
 *
 * @param value - the value to test.
 * @param min - smallest allowed value.
 * @param max - largest allowed value.
 * @returns `true` when the value is in range.
 */
function isIntegerIn(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  )
}

/**
 * Validate one option and return the value to keep. A value that would
 * silently disable a limit (`NaN`, `Infinity`, a string) is refused rather
 * than coerced.
 *
 * @param key - the option name.
 * @param value - the caller's value; never `undefined`.
 * @returns the value to keep; the port list is copied and frozen.
 * @throws {TypeError} when the value is not valid for the option.
 */
function validated(key: OptionKey, value: unknown): unknown {
  switch (key) {
    case "allowHttp":
    case "decompress":
      if (typeof value !== "boolean") throw invalid(key, "a boolean")

      return value
    case "label":
      if (typeof value !== "string") throw invalid(key, "a string")

      return value
    case "maxLength":
    case "maxRedirects":
    case "maxResponseBytes":
      if (!isIntegerIn(value, 0, Number.MAX_SAFE_INTEGER)) {
        throw invalid(key, "a non-negative integer")
      }

      return value
    case "timeoutMs":
      if (!isIntegerIn(value, 1, MAX_TIMEOUT_MS)) {
        throw invalid(key, `an integer from 1 to ${MAX_TIMEOUT_MS}`)
      }

      return value
    case "allowedPorts":
      if (
        !Array.isArray(value) ||
        !value.every((port) => isIntegerIn(port, 1, MAX_PORT))
      ) {
        throw invalid(key, `an array of integer ports from 1 to ${MAX_PORT}`)
      }

      return Object.freeze(Array.from(value))
    default:
      return key satisfies never
  }
}

/**
 * Validate and copy the per-call option fields an object holds as its OWN
 * properties, so an explicit `undefined` never hides a default, unrelated
 * fields are left behind, and a polluted prototype is never read.
 *
 * The result has a `null` prototype, so reading an option it does not hold
 * can never reach `Object.prototype` either.
 *
 * @param source - an options or configuration object.
 * @returns the validated option fields.
 * @throws {TypeError} when a field holds an invalid value.
 * @internal
 */
export function pickOptions(source: SafeFetchOptions): SafeFetchOptions {
  const picked: SafeFetchOptions = Object.create(null) as SafeFetchOptions

  for (const key of OPTION_KEYS) {
    const value: unknown = ownProperty(source, key)

    if (value !== undefined) {
      Object.assign(picked, { [key]: validated(key, value) })
    }
  }

  return picked
}

/**
 * Per-call options over instance defaults: a field set on the call wins,
 * a field left unset (or `undefined`) falls back to the default.
 *
 * @param defaults - the instance defaults, already validated.
 * @param options - the per-call options.
 * @returns the effective options, with a `null` prototype.
 * @throws {TypeError} when a per-call field holds an invalid value.
 * @internal
 */
export function mergeOptions(
  defaults: SafeFetchOptions,
  options: SafeFetchOptions,
): SafeFetchOptions {
  return Object.assign(
    Object.create(null) as SafeFetchOptions,
    defaults,
    pickOptions(options),
  )
}
