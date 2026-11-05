/**
 * Read a property only when the object itself holds it, never through its
 * prototype chain. Options are read this way so that a polluted
 * `Object.prototype` (e.g. `Object.prototype.allowHttp = true`) cannot
 * loosen a request.
 *
 * @param source - the caller's object.
 * @param key - the property to read.
 * @returns the own value, or `undefined` when the object does not hold it.
 * @internal
 */
export function ownProperty<T extends object, K extends keyof T>(
  source: T,
  key: K,
): T[K] | undefined {
  return Object.hasOwn(source, key) ? source[key] : undefined
}
