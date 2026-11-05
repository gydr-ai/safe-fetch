import { describe, expect, it } from "vitest"

import { UnsafeUrlError } from "../../src/errors/unsafe-url-error.js"
import { resolveSafeUrl } from "../../src/fetch/resolve-safe-url.js"

describe("resolveSafeUrl", () => {
  it("returns a public IP literal without a lookup", async () => {
    const result = await resolveSafeUrl("https://1.1.1.1/dns-query")

    expect(result.addresses).toEqual([{ address: "1.1.1.1", family: 4 }])
  })

  it("refuses a private literal", async () => {
    await expect(resolveSafeUrl("https://10.0.0.1/")).rejects.toBeInstanceOf(
      UnsafeUrlError,
    )
  })
})
