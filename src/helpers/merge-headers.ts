/**
 * Per-call request headers over instance defaults: a header named on the
 * call replaces every default value of that name; the rest of the defaults
 * are kept.
 *
 * @param defaults - the instance default headers, or `undefined` for none.
 * @param init - the caller's `init.headers`.
 * @returns a new `Headers` object; neither input is modified.
 * @throws {TypeError} when `init` holds an invalid header.
 * @internal
 */
export function mergeHeaders(
  defaults: Headers | undefined,
  init: RequestInit["headers"],
): Headers {
  const own = new Headers(init ?? undefined)

  if (defaults === undefined) return own

  const merged = new Headers(defaults)

  for (const name of own.keys()) merged.delete(name)

  for (const [name, value] of own) merged.append(name, value)

  return merged
}
