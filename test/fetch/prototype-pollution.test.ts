import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"

import { SafeFetchErrorCode } from "../../src/errors/safe-fetch-error.js"
import { UnsafeUrlReason } from "../../src/errors/unsafe-url-error.js"
import { createSafeFetch } from "../../src/fetch/create-safe-fetch.js"
import {
  at,
  fakeLookup,
  fixture,
  resetFixture,
  startTestServer,
  stopTestServer,
} from "../support/test-server.js"

beforeAll(startTestServer)
afterAll(stopTestServer)
beforeEach(resetFixture)

const proto = Object.prototype as Record<string, unknown>
const polluted: string[] = []

/** Set a property on Object.prototype, removed again after the test. */
function pollute(key: string, value: unknown): void {
  proto[key] = value
  polluted.push(key)
}

afterEach(() => {
  for (const key of polluted.splice(0)) Reflect.deleteProperty(proto, key)
})

const base = { lookup: fakeLookup, allowedRanges: ["127.0.0.1/32"] }

describe("a polluted Object.prototype", () => {
  it("cannot lift the size cap", async () => {
    const capped = createSafeFetch({ ...base, allowHttp: true })

    pollute("maxResponseBytes", Number.POSITIVE_INFINITY)

    await expect(
      capped(
        at("public.test", "/big-declared"),
        {},
        { maxResponseBytes: 1000 },
      ),
    ).rejects.toMatchObject({ code: SafeFetchErrorCode.RESPONSE_TOO_LARGE })

    const defaulted = createSafeFetch({ ...base, allowHttp: true })

    pollute("maxResponseBytes", 1)

    // An inherited 1 would refuse this 5000-byte body; the default 10 MiB holds.
    expect(
      (await (await defaulted(at("public.test", "/big-declared"))).text())
        .length,
    ).toBe(5000)
  })

  it("cannot allow http", async () => {
    pollute("allowHttp", true)

    await expect(
      createSafeFetch(base)(at("public.test", "/ok")),
    ).rejects.toMatchObject({ reason: UnsafeUrlReason.PROTOCOL_NOT_ALLOWED })
  })

  it("cannot turn on redirect following", async () => {
    pollute("redirect", "follow")

    await expect(
      createSafeFetch({ ...base, allowHttp: true })(
        at("public.test", "/redirect"),
      ),
    ).rejects.toMatchObject({ code: SafeFetchErrorCode.REDIRECT_NOT_ALLOWED })
  })

  it("cannot add allowed ranges", async () => {
    pollute("allowedRanges", ["0.0.0.0/0"])

    await expect(
      createSafeFetch({ lookup: fakeLookup, allowHttp: true })(
        at("public.test", "/ok"),
      ),
    ).rejects.toMatchObject({ reason: UnsafeUrlReason.BLOCKED_ADDRESS })
  })

  it("cannot install a hook or a method", async () => {
    let called = false

    pollute("onRequest", () => {
      called = true
    })
    pollute("method", "POST")

    await (
      await createSafeFetch({ ...base, allowHttp: true })(
        at("public.test", "/echo"),
      )
    ).text()
    expect(called).toBe(false)
    expect(fixture.lastRequest.method).toBe("GET")
  })
})

describe("init.redirect", () => {
  it("refuses an unknown mode instead of following", async () => {
    await expect(
      createSafeFetch({ ...base, allowHttp: true })(
        at("public.test", "/redirect"),
        {
          redirect: "bogus" as unknown as NonNullable<RequestInit["redirect"]>,
        },
      ),
    ).rejects.toBeInstanceOf(TypeError)
    expect(fixture.requests).toEqual([])
  })
})
