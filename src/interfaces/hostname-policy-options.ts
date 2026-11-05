/**
 * Hostname rules for `createSafeFetch`, applied to the URL of every hop on
 * top of the built-in blocked names and the address policy. They can only
 * refuse more: no hostname rule can let a blocked address through.
 *
 * A pattern is either an exact hostname (`"api.example.com"`) or a
 * subdomain wildcard (`"*.example.com"`, which matches `a.example.com` and
 * `a.b.example.com` but NOT `example.com` itself). Matching ignores case
 * and a trailing dot.
 */
export interface HostnamePolicyOptions {
  /**
   * Hostnames refused in addition to the built-in list (`localhost`,
   * `*.localhost` and the cloud metadata names). Default: none.
   */
  blockedHostnames?: readonly string[]
  /**
   * When set, an allow-list: every hop's hostname must match one of these
   * patterns or the request is refused, so a redirect cannot leave the
   * list. Matching hosts still go through every other check. An empty list
   * refuses every host. Default: unset (any hostname).
   */
  allowedHostnames?: readonly string[]
}
