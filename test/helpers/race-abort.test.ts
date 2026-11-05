import { describe, expect, it } from "vitest"

import { raceAbort } from "../../src/helpers/race-abort.js"

const reason = (): Error => new Error("aborted")

describe("raceAbort", () => {
  it("resolves with the promise", async () => {
    await expect(
      raceAbort(Promise.resolve(1), new AbortController().signal, reason),
    ).resolves.toBe(1)
  })

  it("rejects at once on an aborted signal", async () => {
    await expect(
      raceAbort(Promise.resolve(1), AbortSignal.abort(), reason),
    ).rejects.toThrow("aborted")
  })

  it("rejects when the signal aborts first", async () => {
    const controller = new AbortController()
    const pending = raceAbort(
      new Promise(() => undefined),
      controller.signal,
      reason,
    )

    controller.abort()
    await expect(pending).rejects.toThrow("aborted")
  })

  it("wraps a non-Error rejection", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const failing = Promise.reject("plain")
    const error = await raceAbort(
      failing,
      new AbortController().signal,
      reason,
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).cause).toBe("plain")
  })
})
