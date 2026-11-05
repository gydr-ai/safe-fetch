import { describe, expect, it } from "vitest"

import { encodeBody } from "../../src/helpers/encode-body.js"

describe("encodeBody", () => {
  it("returns undefined for no body", async () => {
    await expect(encodeBody(undefined)).resolves.toBeUndefined()
    await expect(encodeBody(null)).resolves.toBeUndefined()
  })

  it("encodes a typed-array view by its own window", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]).subarray(1, 3)
    const encoded = await encodeBody(bytes)

    expect([...(encoded?.bytes ?? [])]).toEqual([1, 2])
    expect(encoded?.contentType).toBeUndefined()
  })

  it("leaves an untyped Blob without a content type", async () => {
    expect((await encodeBody(new Blob(["x"])))?.contentType).toBeUndefined()
  })

  it("refuses FormData", async () => {
    await expect(encodeBody(new FormData())).rejects.toMatchObject({
      code: "unsupported_body",
    })
  })
})
