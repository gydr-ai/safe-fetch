import { describe, expect, it } from "vitest"

import { decodersFor } from "../../src/helpers/content-decoders.js"

describe("decodersFor", () => {
  it.each([
    [null, 0],
    ["", 0],
    ["identity", 0],
    ["gzip", 1],
    ["X-GZIP", 1],
    ["deflate", 1],
    ["br", 1],
    ["gzip, br", 2],
    ["gzip, identity, br", 2],
  ])("decodes %j with %i decoder(s)", (header, count) => {
    expect(decodersFor(header)?.length).toBe(count)
  })

  it.each(["zstd", "compress", "gzip, gzip, gzip"])("refuses %j", (header) => {
    expect(decodersFor(header)).toBeNull()
  })
})
