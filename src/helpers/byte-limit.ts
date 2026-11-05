import { Transform, type TransformCallback } from "node:stream"

import {
  SafeFetchError,
  SafeFetchErrorCode,
} from "../errors/safe-fetch-error.js"

/**
 * A pass-through stream that counts bytes and fails once the cap is passed.
 *
 * Placed after the decoders, so the cap applies to the decoded body and a
 * compression bomb is stopped too.
 *
 * @internal
 */
export class ByteLimit extends Transform {
  #seen = 0
  readonly #limit: number

  /**
   * Create the limit.
   *
   * @param limit - the largest number of bytes allowed through.
   */
  constructor(limit: number) {
    super()
    this.#limit = limit
  }

  /**
   * Pass a chunk through, or fail the stream if it takes the total past the
   * limit.
   *
   * @param chunk - the next chunk of body bytes.
   * @param _encoding - unused; chunks are always buffers.
   * @param callback - signals the chunk was handled, or the error.
   */
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.#seen += chunk.byteLength

    if (this.#seen > this.#limit) {
      callback(
        new SafeFetchError(
          SafeFetchErrorCode.RESPONSE_TOO_LARGE,
          `Response body exceeded ${this.#limit} bytes`,
        ),
      )

      return
    }

    callback(null, chunk)
  }
}
