/** An address a hostname resolved to and that passed the address policy. */
export interface ResolvedAddress {
  /** The IP address, normalised (lower case, no brackets or zone). */
  address: string
  /** The IP family of `address`. */
  family: 4 | 6
}
