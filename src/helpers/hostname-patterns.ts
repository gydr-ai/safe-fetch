import { domainToASCII } from "node:url"

import { ipVersion, normalizeAddress } from "./ip.js"

/**
 * Lower-case a hostname and drop one trailing dot (the fully qualified
 * form), so `Example.COM.` and `example.com` compare equal.
 *
 * @param hostname - a hostname or pattern.
 * @returns the canonical form.
 */
function canonical(hostname: string): string {
  const lower = hostname.toLowerCase()

  return lower.endsWith(".") ? lower.slice(0, -1) : lower
}

/**
 * Turn the host part of a pattern into the form a parsed URL uses: an IP
 * literal is normalised, a name is converted to ASCII (punycode,
 * UTS #46), exactly as the WHATWG URL parser does, so `bücher.example`
 * matches the `xn--bcher-kva.example` a URL carries.
 *
 * @param body - the pattern without any leading `*.`.
 * @returns the URL form, or `undefined` when the name is not valid.
 */
function urlForm(body: string): string | undefined {
  switch (ipVersion(body)) {
    case 4:
      return new URL(`http://${normalizeAddress(body)}/`).hostname
    case 6:
      // The URL parser's compressed form, which is what request hosts use.
      return normalizeAddress(
        new URL(`http://[${normalizeAddress(body)}]/`).hostname,
      )
    case 0:
      break
  }

  if (
    body === "" ||
    body.startsWith(".") ||
    body.endsWith(".") ||
    /[\s/@%*:?#[\]\\]/.test(body)
  ) {
    return undefined
  }

  const ascii = domainToASCII(body)

  return ascii === "" || ascii.includes("*") || ascii.includes("..")
    ? undefined
    : ascii
}

/**
 * Compile hostname patterns into a matcher. A pattern is an exact hostname
 * (or IP literal) or `*.suffix`, which matches every subdomain of `suffix`
 * (at any depth) but not `suffix` itself. Matching ignores case and a
 * trailing dot, and internationalised names are compared in their ASCII
 * (punycode) form.
 *
 * @param patterns - the patterns.
 * @param option - the option name, used in the error message.
 * @returns a function that returns `true` when a hostname matches a pattern.
 * @throws {TypeError} when a pattern is malformed.
 * @internal
 */
export function compileHostnamePatterns(
  patterns: readonly string[],
  option: string,
): (hostname: string) => boolean {
  const exact = new Set<string>()
  const suffixes: string[] = []

  for (const raw of patterns) {
    const pattern = typeof raw === "string" ? canonical(raw) : ""
    const wildcard = pattern.startsWith("*.")
    const body = wildcard ? pattern.slice(2) : pattern
    const form = urlForm(body)

    if (form === undefined || (wildcard && ipVersion(body) !== 0)) {
      throw new TypeError(`${option} contains an invalid hostname: ${raw}`)
    }

    if (wildcard) {
      suffixes.push(`.${form}`)
    } else {
      exact.add(form)
    }
  }

  return (hostname) => {
    const name = canonical(hostname)

    return exact.has(name) || suffixes.some((suffix) => name.endsWith(suffix))
  }
}
