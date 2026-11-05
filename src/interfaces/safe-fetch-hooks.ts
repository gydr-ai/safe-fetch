import type { ResolvedAddress } from "./resolved-address.js"

/** What {@link SafeFetchHooks.onResolve} is told about a vetted host. */
export interface ResolveHookInfo {
  /** The normalised hostname or IP literal of the hop. */
  readonly hostname: string
  /** Every address the connection may use; all already passed the policy. */
  readonly addresses: readonly ResolvedAddress[]
}

/** What {@link SafeFetchHooks.onRedirect} is told about a redirect. */
export interface RedirectHookInfo {
  /** A copy of the URL that answered with the redirect. */
  readonly from: URL
  /** A copy of the redirect target; it already passed the URL policy. */
  readonly to: URL
  /** The redirect status (301, 302, 303, 307 or 308). */
  readonly status: number
}

/** What {@link SafeFetchHooks.onRequest} is told about a request. */
export interface RequestHookInfo {
  /** A copy of the URL about to be requested. */
  readonly url: URL
  /** The normalised request method. */
  readonly method: string
  /** The vetted addresses the connection is pinned to. */
  readonly addresses: readonly ResolvedAddress[]
}

/** What {@link SafeFetchHooks.onResponse} is told about a response. */
export interface ResponseHookInfo {
  /** A copy of the URL that answered. */
  readonly url: URL
  /** The response status. */
  readonly status: number
}

/**
 * Synchronous callbacks that let an integrator observe a request or refuse
 * more of it. They run AFTER every built-in check, receive frozen copies
 * (never the objects the request uses), and never see request bodies,
 * header values or response bodies, so a hook cannot loosen a guarantee or
 * read a secret.
 *
 * A hook that throws, or returns a promise, fails the request with a
 * `SafeFetchError` whose code is `hook_failed` and whose `cause` is the
 * thrown value. A decision hook (`onResolve`, `onRedirect`) must return
 * `true`, `false` or nothing; anything else also fails with `hook_failed`.
 */
export interface SafeFetchHooks {
  /**
   * Called for every hop once the host's addresses passed the address
   * policy. Return `false` to refuse the host (an `UnsafeUrlError` with
   * reason `blocked_address`). Default: none.
   */
  onResolve?: (info: ResolveHookInfo) => boolean | undefined
  /**
   * Called before a redirect is followed, after the target passed the URL
   * policy. Return `false` to refuse the hop (a `SafeFetchError` with code
   * `redirect_not_allowed`). Default: none.
   */
  onRedirect?: (info: RedirectHookInfo) => boolean | undefined
  /** Called just before each hop's request is sent. Default: none. */
  onRequest?: (info: RequestHookInfo) => void
  /** Called when each hop's response headers arrive. Default: none. */
  onResponse?: (info: ResponseHookInfo) => void
}
