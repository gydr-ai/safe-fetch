/**
 * Settle with `promise`, unless `signal` aborts first, in which case reject
 * at once with `reason()`. The abort listener is removed either way.
 *
 * A non-`Error` rejection from `promise` is wrapped in an `Error`, so every
 * rejection is an `Error`.
 *
 * @param promise - the work to wait for.
 * @param signal - the signal that cuts the wait short.
 * @param reason - builds the error to reject with on abort.
 * @returns the value `promise` resolved with.
 * @throws {Error} the abort reason, or `promise`'s own rejection.
 * @internal
 */
export function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  reason: () => Error,
): Promise<T> {
  if (signal.aborted) return Promise.reject(reason())

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(reason())
    }

    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort)
        reject(
          error instanceof Error
            ? error
            : new Error(String(error), { cause: error }),
        )
      },
    )
  })
}
