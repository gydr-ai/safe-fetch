/** URL checks shared by `assertSafeUrl`, `resolveSafeUrl` and `safeFetch`. */
export interface UrlPolicy {
  /** Accept `http:` as well as `https:`. Default: `false` (HTTPS only). */
  allowHttp?: boolean
  /** Refuse URLs longer than this many characters. Default: `2048`. */
  maxLength?: number
  /**
   * Only these ports may be dialled. Pass `[443]` (or `[80, 443]`) when you
   * only ever expect standard web servers. Default: any port.
   */
  allowedPorts?: readonly number[]
  /** Name used in error messages, e.g. `"Webhook URL"`. Default: `"URL"`. */
  label?: string
}
