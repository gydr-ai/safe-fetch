import { describe, expect, it } from "vitest"

import { assertSafeUrl, UnsafeUrlError, UnsafeUrlReason } from "../src/url.js"

function reasonOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof UnsafeUrlError) return error.reason
    throw error
  }

  return undefined
}

describe("assertSafeUrl", () => {
  it("returns the parsed URL for a public HTTPS address", () => {
    const url = assertSafeUrl("https://example.com/path?q=1")

    expect(url.hostname).toBe("example.com")
  })

  it("accepts a URL object", () => {
    expect(assertSafeUrl(new URL("https://example.com")).href).toBe(
      "https://example.com/",
    )
  })

  it.each([
    "http://example.com",
    "ftp://example.com",
    "file:///etc/passwd",
    "gopher://example.com",
    "data:text/plain,hi",
    "javascript:alert(1)",
  ])("refuses the scheme of %s by default", (url) => {
    expect(reasonOf(() => assertSafeUrl(url))).toBe(
      UnsafeUrlReason.PROTOCOL_NOT_ALLOWED,
    )
  })

  it("accepts http only when allowed", () => {
    expect(
      assertSafeUrl("http://example.com", { allowHttp: true }).protocol,
    ).toBe("http:")
    expect(
      reasonOf(() => assertSafeUrl("ftp://example.com", { allowHttp: true })),
    ).toBe(UnsafeUrlReason.PROTOCOL_NOT_ALLOWED)
  })

  it("refuses unparseable input", () => {
    expect(reasonOf(() => assertSafeUrl("not a url"))).toBe(
      UnsafeUrlReason.MALFORMED_URL,
    )
  })

  it("refuses over-long input before parsing it", () => {
    const long = `https://example.com/${"a".repeat(3000)}`

    expect(reasonOf(() => assertSafeUrl(long))).toBe(
      UnsafeUrlReason.URL_TOO_LONG,
    )
    expect(assertSafeUrl(long, { maxLength: 4000 }).hostname).toBe(
      "example.com",
    )
  })

  it("refuses credentials in the URL", () => {
    expect(reasonOf(() => assertSafeUrl("https://user:pw@example.com"))).toBe(
      UnsafeUrlReason.CREDENTIALS_IN_URL,
    )
    expect(reasonOf(() => assertSafeUrl("https://user@example.com"))).toBe(
      UnsafeUrlReason.CREDENTIALS_IN_URL,
    )
  })

  it("enforces an explicit port allowlist", () => {
    const policy = { allowedPorts: [443] }

    expect(assertSafeUrl("https://example.com", policy).port).toBe("")
    expect(
      reasonOf(() => assertSafeUrl("https://example.com:8443", policy)),
    ).toBe(UnsafeUrlReason.PORT_NOT_ALLOWED)
    expect(
      reasonOf(() =>
        assertSafeUrl("http://example.com", {
          allowHttp: true,
          allowedPorts: [443],
        }),
      ),
    ).toBe(UnsafeUrlReason.PORT_NOT_ALLOWED)
  })

  it.each([
    "https://localhost",
    "https://LOCALHOST.",
    "https://app.localhost",
    "https://metadata.google.internal",
    "https://metadata",
    "https://instance-data",
    "https://127.0.0.1",
    "https://127.1", // shorthand IPv4
    "https://2130706433", // decimal IPv4
    "https://0x7f.0.0.1", // hex IPv4
    "https://0177.0.0.1", // octal IPv4
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://[::ffff:169.254.169.254]",
    "https://[::127.0.0.1]",
    "https://[64:ff9b::169.254.169.254]",
    "https://[2002:a9fe:a9fe::]",
    "https://[fd00::1]",
    "https://[fe80::1]",
    "https://0.0.0.0",
    "https://10.0.0.1:8080",
  ])("refuses the private target %s", (url) => {
    expect(reasonOf(() => assertSafeUrl(url))).toBe(
      UnsafeUrlReason.BLOCKED_ADDRESS,
    )
  })

  it("uses the label in messages", () => {
    expect(() => assertSafeUrl("http://x", { label: "Webhook URL" })).toThrow(
      "Webhook URL must use the https: scheme",
    )
  })
})
