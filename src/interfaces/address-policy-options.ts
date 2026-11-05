/** Extra ranges for `createAddressPolicy` and `createSafeFetch`, in CIDR notation. */
export interface AddressPolicyOptions {
  /**
   * Ranges refused in addition to the built-in list, e.g.
   * `["203.0.113.0/24"]`. A blocked range wins over an allowed one.
   * Default: none.
   */
  blockedRanges?: readonly string[]
  /**
   * Ranges permitted even though the built-in list refuses them, e.g.
   * `["10.20.0.0/16"]` for a crawler that must reach one internal network.
   * This weakens SSRF protection on purpose: list the narrowest ranges you
   * can, and never a range that contains a metadata service. Default: none.
   */
  allowedRanges?: readonly string[]
}
