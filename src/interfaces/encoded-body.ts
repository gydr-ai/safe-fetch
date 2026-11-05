/**
 * The request body types `safeFetch` accepts: everything `fetch` accepts
 * except streams and `FormData`, whose length is unknown up front.
 *
 * @internal
 */
export type SupportedBody =
  string | URLSearchParams | ArrayBuffer | ArrayBufferView | Blob

/**
 * A request body read into memory, ready to send with a `Content-Length`.
 *
 * @internal
 */
export interface EncodedBody {
  /** The exact bytes to send. */
  bytes: Buffer
  /** The `Content-Type` `fetch` would infer for this body type, if any. */
  contentType: string | undefined
}
