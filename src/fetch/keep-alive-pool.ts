import * as http from "node:http"
import * as https from "node:https"

/**
 * How long an idle pooled socket is kept, in milliseconds. Shorter than the
 * common 5 s server keep-alive, so the client closes first instead of writing
 * into a socket the server is closing.
 *
 * @internal
 */
export const FREE_SOCKET_TIMEOUT_MS = 4_000

/**
 * Idle sockets kept per pool key. Sockets in use are not capped: a cap would
 * let slow requests to one host queue (and time out) requests to every other.
 */
const MAX_FREE_SOCKETS_PER_KEY = 8

/**
 * The request option that carries the vetted addresses into the pool key.
 *
 * @internal
 */
export const PIN_KEY_OPTION = "safeFetchPinKey"

const AGENT_OPTIONS: http.AgentOptions = {
  keepAlive: true,
  maxFreeSockets: MAX_FREE_SOCKETS_PER_KEY,
  scheduling: "lifo",
  // The idle limit of a free socket. Node applies a server's shorter
  // `Keep-Alive: timeout` hint (less a one-second margin) only when this is
  // set. Node acts on the timer only for a FREE socket (and a request clears
  // it while it uses one), so it never cuts a request short.
  timeout: FREE_SOCKET_TIMEOUT_MS,
}

/**
 * The private keep-alive agents of one `createSafeFetch` instance.
 *
 * @internal
 */
export interface KeepAlivePool {
  readonly http: http.Agent
  readonly https: https.Agent
}

/**
 * The pool key: Node's own (host, port, TLS options) plus the vetted
 * addresses. A socket is reused only by a request whose resolution vetted
 * exactly the same addresses, so after a DNS change a request dials a new,
 * pinned socket instead of reusing one to the old address.
 *
 * @param base - Node's key for the request.
 * @param options - the request options, carrying {@link PIN_KEY_OPTION}.
 * @returns the key.
 */
function pinnedName(base: string, options: unknown): string {
  const pin: unknown =
    typeof options === "object" && options !== null
      ? Reflect.get(options, PIN_KEY_OPTION)
      : undefined

  return typeof pin === "string" ? `${base}|${pin}` : base
}

class PinnedHttpAgent extends http.Agent {
  override getName(options?: http.ClientRequestArgs): string {
    return pinnedName(super.getName(options), options)
  }
}

class PinnedHttpsAgent extends https.Agent {
  override getName(options?: https.RequestOptions): string {
    return pinnedName(super.getName(options), options)
  }
}

/**
 * Build a pool on first use. The agents belong to one instance and are never
 * exported or shared, so a socket opened by other code can never be picked
 * up. A socket enters the pool only after it dialled, through the pinned
 * lookup, an address that passed the address policy; the pool is keyed by
 * host, port, TLS options and the vetted addresses, so a reused socket
 * reaches an address this very request's resolution checked.
 *
 * @returns a function that returns the instance's pool, creating it once.
 * @internal
 */
export function lazyKeepAlivePool(): () => KeepAlivePool {
  let pool: KeepAlivePool | undefined

  return () => {
    pool ??= {
      http: new PinnedHttpAgent(AGENT_OPTIONS),
      https: new PinnedHttpsAgent(AGENT_OPTIONS),
    }

    return pool
  }
}
