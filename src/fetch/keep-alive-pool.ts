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

/** Pool bounds, per host and port and in total. */
const MAX_SOCKETS_PER_HOST = 32
const MAX_TOTAL_SOCKETS = 256
const MAX_FREE_SOCKETS_PER_HOST = 8

const AGENT_OPTIONS: http.AgentOptions = {
  keepAlive: true,
  maxSockets: MAX_SOCKETS_PER_HOST,
  maxTotalSockets: MAX_TOTAL_SOCKETS,
  maxFreeSockets: MAX_FREE_SOCKETS_PER_HOST,
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
 * Build a pool on first use. The agents belong to one instance and are never
 * exported or shared, so a socket opened by other code can never be picked
 * up. A socket enters the pool only after it dialled, through the pinned
 * lookup, an address that passed the address policy; Node keys the pool by
 * host and port (plus the TLS server name and options), so a reused socket
 * reaches an address already checked for that very host.
 *
 * @returns a function that returns the instance's pool, creating it once.
 * @internal
 */
export function lazyKeepAlivePool(): () => KeepAlivePool {
  let pool: KeepAlivePool | undefined

  return () => {
    pool ??= {
      http: new http.Agent(AGENT_OPTIONS),
      https: new https.Agent(AGENT_OPTIONS),
    }

    return pool
  }
}
