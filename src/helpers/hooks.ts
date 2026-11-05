import {
  SafeFetchError,
  SafeFetchErrorCode,
} from "../errors/safe-fetch-error.js"

/**
 * Errors this module raised while inspecting a hook's return value. Only
 * these pass through {@link invoke} unwrapped; anything a hook throws, even
 * a `SafeFetchError`, is wrapped so its `cause` is always the thrown value.
 */
const inspectionErrors = new WeakSet<SafeFetchError>()

/**
 * Create a `HOOK_FAILED` error for a bad return value and remember it as
 * this module's own.
 *
 * @param message - the error message.
 * @returns the error to throw.
 */
function hookFailed(message: string): SafeFetchError {
  const error = new SafeFetchError(SafeFetchErrorCode.HOOK_FAILED, message)

  inspectionErrors.add(error)

  return error
}

/**
 * Whether a value is a promise or other thenable.
 *
 * @param value - a hook's return value.
 * @returns `true` for a thenable.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  )
}

/**
 * The error for a hook that returned a promise. Hooks are synchronous: an
 * awaited hook could hold the request past its checks, and an ignored one
 * could fail with no one listening. The promise's own rejection is handled
 * so it cannot crash the process.
 *
 * @param name - the hook's name.
 * @param value - the thenable it returned.
 * @returns the error to throw.
 */
function asyncHookError(
  name: string,
  value: PromiseLike<unknown>,
): SafeFetchError {
  Promise.resolve(value).catch(() => undefined)

  return hookFailed(`The ${name} hook must be synchronous`)
}

/**
 * Run a hook and inspect what it returned, turning ANY failure into a
 * `SafeFetchError` (`HOOK_FAILED`) with the original value as `cause`. The
 * inspection runs inside the same guard because a returned object can
 * throw too (a `then` getter, a Proxy trap).
 *
 * @param name - the hook's name, for the error message.
 * @param hook - the hook.
 * @param info - what the hook is told.
 * @param inspect - turns the return value into the outcome; may throw.
 * @returns what `inspect` returned.
 * @throws {SafeFetchError} `HOOK_FAILED` when the hook or the inspection throws.
 */
function invoke<T, R>(
  name: string,
  hook: (info: T) => unknown,
  info: T,
  inspect: (result: unknown) => R,
): R {
  try {
    return inspect(hook(info))
  } catch (error) {
    if (error instanceof SafeFetchError && inspectionErrors.has(error)) {
      throw error
    }

    throw new SafeFetchError(
      SafeFetchErrorCode.HOOK_FAILED,
      `The ${name} hook threw`,
      { cause: error },
    )
  }
}

/**
 * Run a decision hook. Only `false` refuses; `true` or nothing allows; any
 * other value fails closed, because a hook that meant to refuse must never
 * be read as an allow.
 *
 * @param name - the hook's name, for the error message.
 * @param hook - the hook, or `undefined` when none is configured.
 * @param info - what the hook is told; pass frozen copies only.
 * @returns `true` to continue, `false` to refuse.
 * @throws {SafeFetchError} `HOOK_FAILED` when the hook throws or returns
 *   anything but a boolean or nothing.
 * @internal
 */
export function runDecisionHook<T>(
  name: string,
  hook: ((info: T) => unknown) | undefined,
  info: T,
): boolean {
  if (hook === undefined) return true

  return invoke(name, hook, info, (result) => {
    switch (typeof result) {
      case "undefined":
        return true
      case "boolean":
        return result
      case "bigint":
      case "function":
      case "number":
      case "object":
      case "string":
      case "symbol":
      default:
        if (isThenable(result)) throw asyncHookError(name, result)

        throw hookFailed(`The ${name} hook must return true, false or nothing`)
    }
  })
}

/**
 * Run an observer hook. Its return value is ignored, except that a promise
 * fails the request (hooks are synchronous).
 *
 * @param name - the hook's name, for the error message.
 * @param hook - the hook, or `undefined` when none is configured.
 * @param info - what the hook is told; pass frozen copies only.
 * @throws {SafeFetchError} `HOOK_FAILED` when the hook throws or returns a
 *   promise.
 * @internal
 */
export function runObserverHook<T>(
  name: string,
  hook: ((info: T) => unknown) | undefined,
  info: T,
): void {
  if (hook === undefined) return

  invoke(name, hook, info, (result) => {
    if (isThenable(result)) throw asyncHookError(name, result)
  })
}

/**
 * A frozen copy of vetted addresses, safe to hand to a hook: changing it
 * cannot change the set the connection is pinned to.
 *
 * @param addresses - the vetted addresses.
 * @returns a deep-frozen copy.
 * @internal
 */
export function frozenAddresses<T extends object>(
  addresses: readonly T[],
): readonly T[] {
  return Object.freeze(addresses.map((entry) => Object.freeze({ ...entry })))
}
