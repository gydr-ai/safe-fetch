import type { LookupAddress } from "node:dns"
import { describe, expect, it } from "vitest"

import { pinnedLookup } from "../../src/fetch/pinned-lookup.js"

const lookup = pinnedLookup("example.com", [
  { address: "2606:4700::1", family: 6 },
  { address: "1.1.1.1", family: 4 },
])

function ask(
  hostname: string,
  options: { family?: number; all?: boolean },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    lookup(
      hostname,
      options,
      (
        error: Error | null,
        address: string | LookupAddress[],
        family?: number,
      ) => {
        if (error) reject(error)
        else
          resolve(typeof address === "string" ? { address, family } : address)
      },
    )
  })
}

describe("pinnedLookup", () => {
  it("answers only with the vetted addresses", async () => {
    await expect(ask("example.com", {})).resolves.toEqual({
      address: "2606:4700::1",
      family: 6,
    })
    await expect(ask("EXAMPLE.com", { family: 4 })).resolves.toEqual({
      address: "1.1.1.1",
      family: 4,
    })
    await expect(ask("example.com", { all: true })).resolves.toHaveLength(2)
  })

  it("refuses a different hostname", async () => {
    await expect(ask("evil.example", {})).rejects.toThrow(
      "Resolution target changed mid-request",
    )
  })

  it("refuses a family it has no address for", async () => {
    const v4only = pinnedLookup("example.com", [
      { address: "1.1.1.1", family: 4 },
    ])

    await expect(
      new Promise((resolve, reject) => {
        v4only("example.com", { family: 6 }, (error) => {
          if (error) reject(error)
          else resolve(undefined)
        })
      }),
    ).rejects.toThrow("No address of the requested family")
  })
})
