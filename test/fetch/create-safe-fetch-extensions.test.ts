import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  SafeFetchError,
  SafeFetchErrorCode,
} from "../../src/errors/safe-fetch-error.js"
import {
  UnsafeUrlError,
  UnsafeUrlReason,
} from "../../src/errors/unsafe-url-error.js"
import { createSafeFetch } from "../../src/fetch/create-safe-fetch.js"
import type { SafeFetchConfig } from "../../src/interfaces/safe-fetch-config.js"
import type { SafeFetchOptions } from "../../src/interfaces/safe-fetch-options.js"
import {
  at,
  type EchoedRequest,
  fakeLookup,
  fixture,
  rejection,
  resetFixture,
  startTestServer,
  stopTestServer,
} from "../support/test-server.js"

beforeAll(startTestServer)
afterAll(stopTestServer)
beforeEach(resetFixture)

/** A safeFetch on the test server with extra configuration. */
function fetcher(
  config: SafeFetchConfig = {},
): ReturnType<typeof createSafeFetch> {
  return createSafeFetch({
    lookup: fakeLookup,
    allowedRanges: ["127.0.0.1/32"],
    allowHttp: true,
    ...config,
  })
}

async function echo(response: Response): Promise<EchoedRequest> {
  return (await response.json()) as EchoedRequest
}

const toOther = (path: string): string =>
  at(
    "public.test",
    `/redirect?to=${encodeURIComponent(at("other.test", path))}`,
  )

describe("instance defaults", () => {
  it("applies config options and lets a call override them", async () => {
    const strict = createSafeFetch({
      lookup: fakeLookup,
      allowedRanges: ["127.0.0.1/32"],
      label: "Feed URL",
    })

    await expect(strict(at("public.test", "/ok"))).rejects.toThrow(
      "Feed URL must use the https: scheme",
    )
    expect(
      await (
        await strict(at("public.test", "/ok"), {}, { allowHttp: true })
      ).text(),
    ).toBe("hello")
  })

  it("falls back to the default when a call passes undefined", async () => {
    const capped = fetcher({ maxResponseBytes: 1000 })
    const error = await rejection(
      capped(at("public.test", "/big-declared"), {}, {
        maxResponseBytes: undefined,
      } as unknown as SafeFetchOptions),
    )

    expect((error as SafeFetchError).code).toBe(
      SafeFetchErrorCode.RESPONSE_TOO_LARGE,
    )
  })

  it("uses the default deadline and redirect limit", async () => {
    const quick = fetcher({ timeoutMs: 100, maxRedirects: 1 })

    expect(
      ((await rejection(quick(at("public.test", "/slow")))) as SafeFetchError)
        .code,
    ).toBe(SafeFetchErrorCode.TIMEOUT)
    expect(
      (
        (await rejection(
          quick(at("public.test", "/loop"), { redirect: "follow" }),
        )) as SafeFetchError
      ).code,
    ).toBe(SafeFetchErrorCode.TOO_MANY_REDIRECTS)
  })

  it("copies the configuration, so later changes have no effect", async () => {
    const ports = [fixture.port]
    const config: SafeFetchConfig = { allowedPorts: ports }
    const pinned = fetcher(config)

    ports[0] = 1
    config.onRequest = () => {
      throw new Error("swapped in later")
    }

    expect(await (await pinned(at("public.test", "/ok"))).text()).toBe("hello")
  })
})

describe("hostname rules", () => {
  it("refuses blocked hostnames, exact and wildcard", async () => {
    const blocked = fetcher({
      blockedHostnames: ["Public.Test.", "*.other.test"],
    })

    await expect(blocked(at("public.test", "/ok"))).rejects.toMatchObject({
      reason: UnsafeUrlReason.BLOCKED_ADDRESS,
    })
    expect(fixture.lookups).toEqual([])
    expect(await (await blocked(at("other.test", "/ok"))).text()).toBe("hello")
  })

  it("keeps every hop inside the allow-list", async () => {
    const listed = fetcher({ allowedHostnames: ["public.test"] })

    expect(await (await listed(at("public.test", "/ok"))).text()).toBe("hello")
    await expect(
      listed(toOther("/ok"), { redirect: "follow" }),
    ).rejects.toMatchObject({ reason: UnsafeUrlReason.BLOCKED_ADDRESS })
    expect(fixture.requests).toEqual(["/ok", "/redirect"])
  })

  it("cannot allow a host the built-in policy refuses", async () => {
    const listed = fetcher({ allowedHostnames: ["evil.test", "localhost"] })

    await expect(listed(at("evil.test", "/ok"))).rejects.toBeInstanceOf(
      UnsafeUrlError,
    )
    await expect(listed("http://localhost/")).rejects.toBeInstanceOf(
      UnsafeUrlError,
    )
    expect(fixture.requests).toEqual([])
  })

  it("refuses every host with an empty allow-list", async () => {
    await expect(
      fetcher({ allowedHostnames: [] })(at("public.test", "/ok")),
    ).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it.each(["", "*", "*.", "a*.b", "exa mple.com", "a/b", ".example.com"])(
    "rejects the invalid pattern %j at construction",
    (pattern) => {
      expect(() => createSafeFetch({ blockedHostnames: [pattern] })).toThrow(
        TypeError,
      )
      expect(() => createSafeFetch({ allowedHostnames: [pattern] })).toThrow(
        TypeError,
      )
    },
  )
})

describe("default headers", () => {
  it("sends defaults under per-call headers", async () => {
    const withAgent = fetcher({
      headers: { "user-agent": "agent/1", "x-default": "d" },
    })
    const echoed = await echo(
      await withAgent(at("public.test", "/echo"), {
        headers: { "user-agent": "call/2" },
      }),
    )

    expect(echoed.headers["user-agent"]).toBe("call/2")
    expect(echoed.headers["x-default"]).toBe("d")
  })

  it("still drops transport headers set as defaults", async () => {
    const sneaky = fetcher({
      headers: { host: "internal.example", "transfer-encoding": "chunked" },
    })
    const echoed = await echo(await sneaky(at("public.test", "/echo")))

    expect(echoed.headers.host).toBe(`public.test:${fixture.port}`)
    expect(echoed.headers["transfer-encoding"]).toBeUndefined()
  })

  it("still strips default credentials on a cross-origin redirect", async () => {
    const authed = fetcher({ headers: { authorization: "Bearer default" } })
    const echoed = await echo(
      await authed(toOther("/echo"), { redirect: "follow" }),
    )

    expect(echoed.headers.authorization).toBeUndefined()
  })
})

describe("stripHeadersOnCrossOrigin", () => {
  const stripping = fetcher({ stripHeadersOnCrossOrigin: ["X-Api-Key"] })
  const headers = { "x-api-key": "secret", authorization: "Bearer secret" }

  it("drops extra names, and the built-in ones, across origins", async () => {
    const echoed = await echo(
      await stripping(toOther("/echo"), { redirect: "follow", headers }),
    )

    expect(echoed.headers["x-api-key"]).toBeUndefined()
    expect(echoed.headers.authorization).toBeUndefined()
  })

  it("keeps them on a same-origin redirect", async () => {
    const echoed = await echo(
      await stripping(at("public.test", "/redirect?to=/echo"), {
        redirect: "follow",
        headers,
      }),
    )

    expect(echoed.headers["x-api-key"]).toBe("secret")
  })

  it("rejects an invalid header name at construction", () => {
    expect(() =>
      createSafeFetch({ stripHeadersOnCrossOrigin: ["bad name"] }),
    ).toThrow(TypeError)
  })
})

describe("onResolve", () => {
  it("sees the vetted addresses and can refuse a host", async () => {
    const seen: unknown[] = []
    const refusing = fetcher({
      onResolve: (info) => {
        seen.push(info)

        return info.hostname !== "public.test"
      },
    })

    await expect(refusing(at("public.test", "/ok"))).rejects.toMatchObject({
      reason: UnsafeUrlReason.BLOCKED_ADDRESS,
    })
    expect(seen).toEqual([
      {
        hostname: "public.test",
        addresses: [{ address: "127.0.0.1", family: 4 }],
      },
    ])
    expect(fixture.requests).toEqual([])
  })

  it("cannot let a blocked answer through", async () => {
    let called = false
    const permissive = fetcher({
      onResolve: () => {
        called = true

        return true
      },
    })

    await expect(permissive(at("rebind.test", "/ok"))).rejects.toMatchObject({
      reason: UnsafeUrlReason.BLOCKED_ADDRESS,
    })
    expect(called).toBe(false)
  })

  it("cannot change the pinned addresses", async () => {
    const tampering = fetcher({
      onResolve: (info) => {
        ;(info.addresses as Array<{ address: string; family: number }>).push({
          address: "10.9.9.9",
          family: 4,
        })
      },
    })

    await expect(tampering(at("public.test", "/ok"))).rejects.toMatchObject({
      code: SafeFetchErrorCode.HOOK_FAILED,
    })
    expect(fixture.requests).toEqual([])
  })

  it.each([
    [
      "throws",
      () => {
        throw new Error("boom")
      },
    ],
    ["returns a promise", () => Promise.resolve(true)],
    ["returns a non-boolean", () => "yes"],
  ])("fails closed when the hook %s", async (_name, hook) => {
    const broken = fetcher({ onResolve: hook as unknown as () => boolean })
    const error = await rejection(broken(at("public.test", "/ok")))

    expect(error).toBeInstanceOf(SafeFetchError)
    expect((error as SafeFetchError).code).toBe(SafeFetchErrorCode.HOOK_FAILED)
    expect(fixture.requests).toEqual([])
  })

  it("keeps the thrown value as the cause", async () => {
    const cause = new Error("boom")
    const error = await rejection(
      fetcher({
        onResolve: () => {
          throw cause
        },
      })(at("public.test", "/ok")),
    )

    expect((error as SafeFetchError).cause).toBe(cause)
  })
})

describe("onRedirect", () => {
  it("is told about the hop and can refuse it", async () => {
    const seen: Array<{ from: string; to: string; status: number }> = []
    const refusing = fetcher({
      onRedirect: ({ from, to, status }) => {
        seen.push({ from: from.href, to: to.href, status })

        return false
      },
    })

    await expect(
      refusing(at("public.test", "/redirect?status=307&to=/ok"), {
        redirect: "follow",
      }),
    ).rejects.toMatchObject({ code: SafeFetchErrorCode.REDIRECT_NOT_ALLOWED })
    expect(seen).toEqual([
      {
        from: at("public.test", "/redirect?status=307&to=/ok"),
        to: at("public.test", "/ok"),
        status: 307,
      },
    ])
    expect(fixture.requests).toEqual(["/redirect"])
  })

  it("cannot follow a redirect to a blocked host", async () => {
    let called = false
    const permissive = fetcher({
      onRedirect: () => {
        called = true

        return true
      },
    })
    const to = encodeURIComponent("http://169.254.169.254/")

    await expect(
      permissive(at("public.test", `/redirect?to=${to}`), {
        redirect: "follow",
      }),
    ).rejects.toMatchObject({ reason: UnsafeUrlReason.BLOCKED_ADDRESS })
    expect(called).toBe(false)
  })

  it("cannot follow a redirect in error mode or past the limit", async () => {
    const permissive = fetcher({ onRedirect: () => true, maxRedirects: 1 })

    await expect(
      permissive(at("public.test", "/redirect")),
    ).rejects.toMatchObject({ code: SafeFetchErrorCode.REDIRECT_NOT_ALLOWED })
    await expect(
      permissive(at("public.test", "/loop"), { redirect: "follow" }),
    ).rejects.toMatchObject({ code: SafeFetchErrorCode.TOO_MANY_REDIRECTS })
  })

  it("cannot re-target the hop by changing its copy", async () => {
    const tampering = fetcher({
      onRedirect: ({ to }) => {
        to.pathname = "/no-content"
      },
    })
    const response = await tampering(at("public.test", "/redirect?to=/ok"), {
      redirect: "follow",
    })

    expect(await response.text()).toBe("hello")
    expect(fixture.requests).toEqual(["/redirect", "/ok"])
  })

  it("fails with hook_failed when it throws", async () => {
    await expect(
      fetcher({
        onRedirect: () => {
          throw new Error("boom")
        },
      })(at("public.test", "/redirect"), { redirect: "follow" }),
    ).rejects.toMatchObject({ code: SafeFetchErrorCode.HOOK_FAILED })
  })
})

describe("onRequest", () => {
  it("observes each hop without seeing headers or the body", async () => {
    const seen: Array<Record<string, unknown>> = []
    const observed = fetcher({
      onRequest: (info) => {
        seen.push({ ...info, url: info.url.href })
      },
    })

    await (
      await observed(at("public.test", "/redirect?status=303&to=/ok"), {
        method: "PUT",
        body: "secret body",
        headers: { authorization: "Bearer secret" },
        redirect: "follow",
      })
    ).text()

    expect(seen).toEqual([
      {
        url: at("public.test", "/redirect?status=303&to=/ok"),
        method: "PUT",
        addresses: [{ address: "127.0.0.1", family: 4 }],
      },
      {
        url: at("public.test", "/ok"),
        method: "GET",
        addresses: [{ address: "127.0.0.1", family: 4 }],
      },
    ])
  })

  it("cannot re-target the request by changing its copy", async () => {
    const tampering = fetcher({
      onRequest: ({ url }) => {
        url.hostname = "evil.test"
        url.pathname = "/echo"
      },
    })

    expect(await (await tampering(at("public.test", "/ok"))).text()).toBe(
      "hello",
    )
    expect(fixture.requests).toEqual(["/ok"])
  })

  it("stops the request when it throws or is async", async () => {
    for (const hook of [
      () => {
        throw new Error("boom")
      },
      (() => Promise.reject(new Error("async"))) as unknown as () => void,
    ]) {
      await expect(
        fetcher({ onRequest: hook })(at("public.test", "/ok")),
      ).rejects.toMatchObject({ code: SafeFetchErrorCode.HOOK_FAILED })
    }

    expect(fixture.requests).toEqual([])
  })
})

describe("onResponse", () => {
  it("observes the status of every hop", async () => {
    const seen: Array<[string, number]> = []
    const observed = fetcher({
      onResponse: ({ url, status }) => {
        seen.push([url.pathname, status])
      },
    })

    await (
      await observed(at("public.test", "/redirect?to=/ok"), {
        redirect: "follow",
      })
    ).text()

    expect(seen).toEqual([
      ["/redirect", 302],
      ["/ok", 200],
    ])
  })

  it("cannot lift the size cap", async () => {
    const observed = fetcher({ onResponse: () => undefined })
    const response = await observed(
      at("public.test", "/big-chunked"),
      {},
      { maxResponseBytes: 4000 },
    )

    await expect(response.text()).rejects.toMatchObject({
      code: SafeFetchErrorCode.RESPONSE_TOO_LARGE,
    })
  })

  it("closes the socket when it throws", async () => {
    const broken = fetcher({
      onResponse: () => {
        throw new Error("boom")
      },
    })

    await expect(
      broken(at("public.test", "/stall-over-cap")),
    ).rejects.toMatchObject({ code: SafeFetchErrorCode.HOOK_FAILED })

    const peer = fixture.stalled.pop()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(peer?.socket?.destroyed ?? true).toBe(true)
  })
})

it("rejects a hook that is not a function at construction", () => {
  expect(() =>
    createSafeFetch({ onRequest: "log" } as unknown as SafeFetchConfig),
  ).toThrow(TypeError)
})

describe("option validation", () => {
  it("refuses a bad instance default at construction", () => {
    expect(() => createSafeFetch({ maxResponseBytes: Number.NaN })).toThrow(
      TypeError,
    )
    expect(() =>
      createSafeFetch({ timeoutMs: Number.POSITIVE_INFINITY }),
    ).toThrow(TypeError)
  })

  it("refuses a bad per-call value before any request", async () => {
    await expect(
      fetcher()(at("public.test", "/ok"), {}, {
        maxResponseBytes: "1024",
      } as unknown as SafeFetchOptions),
    ).rejects.toBeInstanceOf(TypeError)
    expect(fixture.requests).toEqual([])
  })
})

describe("hostname rules on odd names", () => {
  it("refuses a name with extra trailing dots instead of skipping the rule", async () => {
    const blocked = fetcher({ blockedHostnames: ["public.test"] })

    await expect(blocked(at("public.test..", "/ok"))).rejects.toMatchObject({
      reason: UnsafeUrlReason.MALFORMED_URL,
    })
    expect(fixture.lookups).toEqual([])
  })
})
