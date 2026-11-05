/**
 * The TCP port a URL dials: its explicit port, else the scheme default.
 *
 * @param url - an `http:` or `https:` URL.
 * @returns the port number.
 * @internal
 */
export function portOf(url: URL): number {
  if (url.port !== "") return Number(url.port)

  switch (url.protocol) {
    case "https:":
      return 443
    default:
      return 80
  }
}
