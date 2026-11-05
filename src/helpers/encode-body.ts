import {
  SafeFetchError,
  SafeFetchErrorCode,
} from "../errors/safe-fetch-error.js"
import type { EncodedBody, SupportedBody } from "../interfaces/encoded-body.js"

/**
 * Whether a request body is one of the {@link SupportedBody} types.
 *
 * @param body - the caller's `init.body`.
 * @returns `true` for a supported type.
 */
function isSupportedBody(body: unknown): body is SupportedBody {
  return (
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof Blob
  )
}

/**
 * Read a request body into memory, with the `Content-Type` `fetch` would
 * infer for it (Fetch Standard "extract a body").
 *
 * Streams and `FormData` are refused: the body is sent with an exact
 * `Content-Length`, and is replayed on a 307/308 redirect.
 *
 * @param body - the caller's `init.body`.
 * @returns the encoded body, or `undefined` when there is none.
 * @throws {SafeFetchError} `UNSUPPORTED_BODY` for any other body type.
 * @internal
 */
export async function encodeBody(
  body: RequestInit["body"],
): Promise<EncodedBody | undefined> {
  if (body === null || body === undefined) return undefined

  if (!isSupportedBody(body)) {
    throw new SafeFetchError(
      SafeFetchErrorCode.UNSUPPORTED_BODY,
      "Body must be a string, URLSearchParams, ArrayBuffer, typed array or Blob",
    )
  }

  if (typeof body === "string") {
    return { bytes: Buffer.from(body), contentType: "text/plain;charset=UTF-8" }
  }

  if (body instanceof URLSearchParams) {
    return {
      bytes: Buffer.from(body.toString()),
      contentType: "application/x-www-form-urlencoded;charset=UTF-8",
    }
  }

  if (body instanceof Blob) {
    return {
      bytes: Buffer.from(await body.arrayBuffer()),
      contentType: body.type === "" ? undefined : body.type,
    }
  }

  if (body instanceof ArrayBuffer) {
    return { bytes: Buffer.from(body), contentType: undefined }
  }

  return {
    bytes: Buffer.from(body.buffer, body.byteOffset, body.byteLength),
    contentType: undefined,
  }
}
