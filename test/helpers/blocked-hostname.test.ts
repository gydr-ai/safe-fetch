import { describe, expect, it } from "vitest"

import { isBlockedHostname } from "../../src/helpers/blocked-hostname.js"

describe("isBlockedHostname", () => {
  it.each(["localhost", "localhost.", "a.localhost", "metadata.goog"])(
    "blocks %s",
    (host) => {
      expect(isBlockedHostname(host)).toBe(true)
    },
  )

  it.each(["example.com", "localhost.example.com", "notlocalhost"])(
    "allows %s",
    (host) => {
      expect(isBlockedHostname(host)).toBe(false)
    },
  )
})
