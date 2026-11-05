import { describe, expect, it } from "vitest"

import {
  SafeFetchError,
  SafeFetchErrorCode,
} from "../../src/errors/safe-fetch-error.js"
import {
  runDecisionHook,
  frozenAddresses,
  runObserverHook,
} from "../../src/helpers/hooks.js"

describe("runDecisionHook", () => {
  it("allows when there is no hook, or it returns true or nothing", () => {
    expect(runDecisionHook("h", undefined, {})).toBe(true)
    expect(runDecisionHook("h", () => true, {})).toBe(true)
    expect(runDecisionHook("h", () => undefined, {})).toBe(true)
    expect(runDecisionHook("h", () => false, {})).toBe(false)
  })

  it.each([0, "", null, {}, Symbol("s"), 1n, () => false])(
    "fails closed on the return value %#",
    (value) => {
      expect(() => runDecisionHook("onResolve", () => value, {})).toThrow(
        expect.objectContaining({ code: SafeFetchErrorCode.HOOK_FAILED }),
      )
    },
  )

  it("refuses an async hook without leaking an unhandled rejection", () => {
    expect(() =>
      runDecisionHook("onRedirect", () => Promise.reject(new Error("x")), {}),
    ).toThrow("The onRedirect hook must be synchronous")
  })
})

describe("runObserverHook", () => {
  it("ignores ordinary return values", () => {
    expect(() => {
      runObserverHook("h", () => 42, {})
    }).not.toThrow()
    expect(() => {
      runObserverHook("h", undefined, {})
    }).not.toThrow()
  })

  it("wraps a throw with its cause", () => {
    const cause = new Error("boom")

    expect(() => {
      runObserverHook(
        "onRequest",
        () => {
          throw cause
        },
        {},
      )
    }).toThrow(expect.objectContaining({ code: "hook_failed", cause }))
  })
})

describe("frozenAddresses", () => {
  it("returns a deep-frozen copy", () => {
    const original = [{ address: "1.1.1.1", family: 4 as const }]
    const copy = frozenAddresses(original)

    expect(copy).toEqual(original)
    expect(copy).not.toBe(original)
    expect(Object.isFrozen(copy)).toBe(true)
    expect(Object.isFrozen(copy[0])).toBe(true)
  })
})

describe("hook return inspection", () => {
  it.each([
    [
      "a throwing then getter",
      () => ({
        get then(): never {
          throw new Error("then-getter")
        },
      }),
    ],
    [
      "a Proxy whose has trap throws",
      () =>
        new Proxy(
          {},
          {
            has(): never {
              throw new Error("has-trap")
            },
          },
        ),
    ],
  ])("turns %s into hook_failed", (_name, hook) => {
    for (const run of [runDecisionHook, runObserverHook]) {
      expect(() => {
        run("h", hook, {})
      }).toThrow(
        expect.objectContaining({
          code: SafeFetchErrorCode.HOOK_FAILED,
          cause: expect.any(Error) as unknown,
        }),
      )
    }
  })

  it("wraps a SafeFetchError a hook throws, keeping it as the cause", () => {
    const forged = new SafeFetchError(SafeFetchErrorCode.HOOK_FAILED, "forged")

    expect(() =>
      runDecisionHook(
        "h",
        () => {
          throw forged
        },
        {},
      ),
    ).toThrow(expect.objectContaining({ cause: forged }))
  })

  it("keeps the error codes object frozen", () => {
    expect(Object.isFrozen(SafeFetchErrorCode)).toBe(true)
  })
})
