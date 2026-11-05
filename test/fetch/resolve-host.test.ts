import { describe, expect, it } from "vitest"

import { SafeFetchErrorCode } from "../../src/errors/safe-fetch-error.js"
import { dependenciesFor } from "../../src/fetch/dependencies.js"
import { resolveHost } from "../../src/fetch/resolve-host.js"
import type { LookupResult } from "../../src/interfaces/safe-fetch-config.js"

function resolveWith(answer: unknown): ReturnType<typeof resolveHost> {
  return resolveHost(
    "example.test",
    "URL",
    dependenciesFor({
      lookup: () => Promise.resolve(answer as LookupResult[]),
      allowedRanges: ["127.0.0.0/8"],
    }),
  )
}

describe("resolveHost", () => {
  it("reads each record once, so the check and the pin see one address", async () => {
    let reads = 0
    const record = {
      get address(): string {
        reads += 1

        return reads === 1 ? "127.0.0.1" : "10.9.9.9"
      },
      family: 4,
    }

    await expect(resolveWith([record])).resolves.toEqual([
      { address: "127.0.0.1", family: 4 },
    ])
    expect(reads).toBe(1)
  })

  it("ignores an overridden map on the answer", async () => {
    const answer = new Proxy([{ address: "127.0.0.1", family: 4 }], {
      get(target, key, receiver): unknown {
        if (key === "map") {
          return () => [{ address: "10.9.9.9", family: 4 }]
        }

        return Reflect.get(target, key, receiver) as unknown
      },
    })

    await expect(resolveWith(answer)).resolves.toEqual([
      { address: "127.0.0.1", family: 4 },
    ])
  })

  it.each([
    ["undefined", undefined],
    ["a string", "127.0.0.1"],
    ["an object", { address: "127.0.0.1" }],
    ["a numeric address", [{ address: 2130706433, family: 4 }]],
    ["a null record", [null]],
    [
      "a throwing getter",
      [
        {
          get address(): never {
            throw new Error("getter")
          },
        },
      ],
    ],
  ])("reports %s as a DNS failure", async (_name, answer) => {
    await expect(resolveWith(answer)).rejects.toMatchObject({
      code: SafeFetchErrorCode.DNS_FAILURE,
    })
  })

  it("derives each address family from the address, not the resolver", async () => {
    const resolved = await resolveWith([
      { address: "127.0.0.1", family: 6 },
      { address: "::ffff:127.0.0.2", family: 4 },
    ])

    expect(resolved).toEqual([
      { address: "127.0.0.1", family: 4 },
      { address: "::ffff:127.0.0.2", family: 6 },
    ])
  })
})
