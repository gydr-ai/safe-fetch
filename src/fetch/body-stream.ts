import type { IncomingMessage } from "node:http"
import type { Readable, Transform } from "node:stream"

import {
  SafeFetchError,
  SafeFetchErrorCode,
} from "../errors/safe-fetch-error.js"
import { ByteLimit } from "../helpers/byte-limit.js"

/**
 * The response body as a web stream over `incoming → decoders → limit`.
 *
 * Built by hand rather than with `Readable.toWeb`: cancelling a converted
 * stream while the pipe still feeds it enqueues into a closed controller
 * from an event handler, which crashes the process. Every way the stream
 * ends (done, error, cap, cancel, deadline) tears the whole chain down, so
 * the socket never outlives the request. A socket that closes before the
 * body is complete is reported as an error, never as a short body.
 *
 * @param incoming - the response from `http.request`.
 * @param decoders - the content decoders, in the order to apply them.
 * @param maxBytes - the largest decoded body allowed.
 * @param onClose - called once when the stream ends for any reason.
 * @returns a byte stream for the `Response` body.
 * @internal
 */
export function bodyStream(
  incoming: IncomingMessage,
  decoders: readonly Transform[],
  maxBytes: number,
  onClose: () => void,
): ReadableStream<Uint8Array> {
  const limit = new ByteLimit(maxBytes)
  const stages: Array<Readable | Transform> = [incoming, ...decoders, limit]
  let open = true

  const teardown = (error?: Error): void => {
    if (!open) return

    open = false
    onClose()

    for (const stage of stages) {
      stage.unpipe()
      stage.destroy(error)
    }
  }

  let tail: Readable = incoming

  for (const stage of [...decoders, limit]) tail = tail.pipe(stage)

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const fail = (error: Error): void => {
        if (open) controller.error(error)
        teardown(error)
      }

      incoming.on("error", fail)

      for (const decoder of decoders) {
        decoder.on("error", (error) => {
          fail(
            new SafeFetchError(
              SafeFetchErrorCode.NETWORK_ERROR,
              "Response body could not be decoded",
              { cause: error },
            ),
          )
        })
      }

      limit.on("error", fail)
      limit.on("data", (chunk: Buffer) => {
        if (!open) return

        controller.enqueue(new Uint8Array(chunk))

        if ((controller.desiredSize ?? 0) <= 0) limit.pause()
      })
      limit.once("end", () => {
        if (open) controller.close()
        teardown()
      })
      incoming.once("close", () => {
        if (!incoming.complete) {
          fail(
            new SafeFetchError(
              SafeFetchErrorCode.NETWORK_ERROR,
              "Response ended before the body was complete",
            ),
          )
        }
      })
    },
    pull() {
      limit.resume()
    },
    cancel() {
      teardown()
    },
  })
}
