import { describe, expect, it } from "vitest"

import { ownProperty } from "../../src/helpers/own-property.js"

describe("ownProperty", () => {
  it("reads own properties and ignores inherited ones", () => {
    const inherited: { a?: number } = Object.create({ a: 1 }) as { a?: number }

    expect(ownProperty({ a: 2 }, "a")).toBe(2)
    expect(ownProperty(inherited, "a")).toBeUndefined()
  })
})
