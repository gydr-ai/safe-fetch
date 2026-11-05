import type { Transform } from "node:stream"
import * as zlib from "node:zlib"

import { MAX_CONTENT_ENCODINGS } from "../constants/defaults.js"

/**
 * A fresh decoder for one content coding.
 *
 * @param coding - a lower-cased coding name from `Content-Encoding`.
 * @returns the decoder, or `undefined` for a coding this package cannot decode.
 */
function decoderFor(coding: string): Transform | undefined {
  switch (coding) {
    case "gzip":
    case "x-gzip":
    case "deflate":
      return zlib.createUnzip()
    case "br":
      return zlib.createBrotliDecompress()
    default:
      return undefined
  }
}

/**
 * The decoders for a `Content-Encoding` header, in the order to apply them
 * (the header lists codings in the order they were APPLIED, RFC 9110
 * § 8.4).
 *
 * An unknown coding is refused rather than passed through: the size cap
 * could only count the encoded bytes, and the caller would then decode a
 * bomb with no limit.
 *
 * @param header - the `Content-Encoding` header value, or `null` for none.
 * @returns the decoders (empty for none), or `null` when a coding is unknown
 *   or the stack is deeper than allowed.
 * @internal
 */
export function decodersFor(header: string | null): Transform[] | null {
  const codings = (header ?? "")
    .split(",")
    .map((coding) => coding.trim().toLowerCase())
    .filter((coding) => coding !== "" && coding !== "identity")

  if (codings.length > MAX_CONTENT_ENCODINGS) return null

  const decoders: Transform[] = []

  for (const coding of codings.reverse()) {
    const decoder = decoderFor(coding)

    if (decoder === undefined) return null

    decoders.push(decoder)
  }

  return decoders
}
