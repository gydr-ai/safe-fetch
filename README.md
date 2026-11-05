# @gydr-ai/safe-fetch

[![npm](https://img.shields.io/npm/v/@gydr-ai/safe-fetch)](https://www.npmjs.com/package/@gydr-ai/safe-fetch)
[![CI](https://github.com/gydr-ai/safe-fetch/actions/workflows/ci.yml/badge.svg)](https://github.com/gydr-ai/safe-fetch/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/gydr-ai/safe-fetch/badge)](https://scorecard.dev/viewer/?uri=github.com/gydr-ai/safe-fetch)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

`fetch` for URLs you do not control, for Node.js.

AI agents, MCP servers, webhook senders, link previewers and crawlers all
fetch URLs that come from users, configuration or a language model. Any of
those can point the request back inside your network: at a cloud metadata
service, a database admin page, or `localhost`. That is Server-Side Request
Forgery (SSRF, [CWE-918](https://cwe.mitre.org/data/definitions/918.html)).

`safeFetch` is a drop-in replacement that:

- **blocks private, reserved and metadata addresses** in IPv4 and IPv6,
  including IPv4 hidden inside IPv6 (`[::ffff:127.0.0.1]`, NAT64, 6to4) and
  every notation the URL parser accepts (`127.1`, `2130706433`, `0x7f.1`);
- **closes the DNS-rebinding window** by resolving the hostname once,
  checking _every_ address, and connecting to exactly the address it
  checked, while keeping the real `Host` header and TLS certificate checks;
- **re-checks every redirect** as a fresh request, and refuses redirects
  unless you opt in;
- **drops credentials** (`Authorization`, `Cookie`, `Proxy-Authorization`)
  when a redirect leaves the original origin, as the Fetch standard does;
- **bounds the whole exchange** with one deadline and one response size cap
  that counts _decompressed_ bytes, so a compression bomb is stopped too.

It has no runtime dependencies.

## Install

```bash
npm install @gydr-ai/safe-fetch
```

Requires Node.js 22.12 or later. ESM only.

## Usage

```ts
import { safeFetch, SafeFetchError, UnsafeUrlError } from "@gydr-ai/safe-fetch"

try {
  const response = await safeFetch(userSuppliedUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })

  console.log(response.status, await response.json())
} catch (error) {
  if (error instanceof UnsafeUrlError) {
    // The URL, or an address it resolved to, is not allowed.
    console.warn("refused:", error.reason) // e.g. "blocked_address"
  } else if (error instanceof SafeFetchError) {
    console.warn("failed:", error.code) // e.g. "timeout"
  } else {
    throw error
  }
}
```

It returns a standard `Response`, so `.ok`, `.status`, `.headers`,
`.json()`, `.text()` and `.body` work as usual.

### Validate input before you store it

Use `assertSafeUrl` when a user saves a URL (a webhook endpoint, a plugin
address), so they get an immediate, specific error instead of a failure at
delivery time. It does not touch the network.

```ts
import { assertSafeUrl, UnsafeUrlError } from "@gydr-ai/safe-fetch"

try {
  assertSafeUrl(body.webhookUrl, { label: "Webhook URL" })
} catch (error) {
  if (error instanceof UnsafeUrlError) {
    return badRequest({ field: "webhookUrl", code: error.reason, message: error.message })
  }
  throw error
}
```

Always call `safeFetch` at delivery time as well: a hostname that was
public when it was saved can resolve to a private address later.

### When another library owns the socket

`resolveSafeUrl` checks a URL and every address it currently resolves to.
Use it only when you cannot route the request through `safeFetch` (for
example, a vendor SDK). The SDK resolves the name again, so a rebinding
window remains; prefer `safeFetch` whenever you can.

## Customising

`createSafeFetch(config)` returns a `safeFetch` with your own resolver or
address ranges. The default export is `createSafeFetch()`.

```ts
import { createSafeFetch } from "@gydr-ai/safe-fetch"

const fetchExternal = createSafeFetch({
  // Refuse more than the built-in list, e.g. your own public ranges.
  blockedRanges: ["203.0.113.0/24", "2001:db8:abcd::/48"],
  // Permit one internal network on purpose (a crawler for your intranet).
  allowedRanges: ["10.20.0.0/16"],
  // Resolve through your own resolver (DNS-over-HTTPS, a cache, tests).
  lookup: async (hostname) => myResolver.resolveAll(hostname),
})
```

| Config          | Meaning                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockedRanges` | CIDR ranges refused in addition to the built-in list. A blocked range always wins over an allowed one.                                                                                  |
| `allowedRanges` | CIDR ranges permitted although the built-in list refuses them. This deliberately weakens the protection: list the narrowest ranges you can, never one that contains a metadata service. |
| `lookup`        | `(hostname) => Promise<{ address, family }[]>`. Every returned address is still checked, and the connection is still pinned to one of them. Defaults to the operating system resolver.  |

The blocked hostnames (`localhost`, metadata names) cannot be allowed.
`createAddressPolicy({ blockedRanges, allowedRanges })` gives you the same
decision as a plain function, for checks outside a request.

## Options

`safeFetch(input, init?, options?)`

| Option             | Default | Meaning                                                                                                                                                                            |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowHttp`        | `false` | Accept `http:` as well as `https:`.                                                                                                                                                |
| `allowedPorts`     | any     | Only dial these ports, e.g. `[443]`.                                                                                                                                               |
| `maxLength`        | `2048`  | Refuse longer URLs.                                                                                                                                                                |
| `timeoutMs`        | `15000` | One deadline for DNS, connect, every redirect and reading the whole body.                                                                                                          |
| `maxResponseBytes` | 10 MiB  | Largest body accepted, counted after decompression.                                                                                                                                |
| `maxRedirects`     | `5`     | Hops followed when `init.redirect` is `"follow"`.                                                                                                                                  |
| `decompress`       | `true`  | Decode `gzip`, `deflate` (zlib) and `br`, up to two stacked layers. Any other encoding is refused (`unsupported_encoding`), because the size cap could not count its decoded size. |
| `label`            | `"URL"` | Name used in error messages, e.g. `"Webhook URL"`.                                                                                                                                 |

`assertSafeUrl(input, options?)` and `resolveSafeUrl(input, options?)` take
`allowHttp`, `allowedPorts`, `maxLength` and `label`.

`init` is a normal `RequestInit`, with these differences from `fetch`:

- `redirect` defaults to `"error"`. Pass `"follow"` to follow redirects
  (each hop is re-checked) or `"manual"` to receive the 3xx response.
- `body` may be a string, `URLSearchParams`, `ArrayBuffer`, typed array or
  `Blob`. Streams and `FormData` are refused.
- `signal` is honoured alongside `timeoutMs`; whichever fires first wins.
- Credentials in **custom** headers (`X-Api-Key` and similar) are kept on a
  cross-origin redirect, as with `fetch`. If you send one, keep the default
  `redirect: "error"`, or use `"manual"` and decide yourself.
- `CONNECT`, `TRACE`, `TRACK` and methods that are not valid HTTP tokens are
  refused. `Host`, `Connection`,
  `Transfer-Encoding` and other transport headers are set by the library.

## Errors

| Class            | Property | Values                                                                                                                                                                          |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UnsafeUrlError` | `reason` | `url_too_long`, `malformed_url`, `protocol_not_allowed`, `credentials_in_url`, `port_not_allowed`, `blocked_address`                                                            |
| `SafeFetchError` | `code`   | `dns_failure`, `timeout`, `redirect_not_allowed`, `too_many_redirects`, `response_too_large`, `unsupported_body`, `unsupported_method`, `unsupported_encoding`, `network_error` |

When the caller's own `signal` aborts, its `reason` is thrown unchanged, as
with `fetch`. A size, deadline or decoding failure while you read the body
rejects that read (`response.text()` and friends) with a `SafeFetchError`,
and the connection is closed at once. Cancelling `response.body` also
closes it.

## What is blocked

Every address in these ranges is refused, whether it appears in the URL or
in any DNS answer:

| Family       | Ranges                                                                                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IPv4         | `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`  |
| IPv6         | Everything outside global unicast `2000::/3` (loopback, unspecified, unique-local, link-local, site-local, multicast, ISATAP, local-use NAT64, discard and unassigned space). Inside it: `2001::/23` (incl. Teredo), `2001:db8::/32` and `3fff::/20`. |
| IPv4 in IPv6 | IPv4-mapped `::ffff:0:0/96`, NAT64 `64:ff9b::/96` and 6to4 `2002::/16` are unwrapped and the embedded IPv4 is judged by the IPv4 list, so public IPv4 through NAT64 still works.                                                                      |
| Names        | `localhost`, `*.localhost`, `metadata`, `metadata.google.internal`, `metadata.goog`, `instance-data`, `instance-data.ec2.internal`                                                                                                                    |

`isBlockedAddress(address)` is exported if you need the same decision
elsewhere.

## Security model

**Protects against:** user, configuration or model-supplied URLs reaching
internal services or cloud metadata; DNS rebinding between check and
connect; redirects into internal space; credential leaks across origins on
redirect; oversized and compression-bomb responses; slow-loris style
responses that never finish.

**Does not protect against:**

- Internal services on _public_ IP addresses. If you have them, block those
  addresses at the network layer as well.
- Abuse of the target itself. A public URL can still be a slow or hostile
  server; `safeFetch` only bounds the cost to you.
- Proxies. `safeFetch` connects directly and ignores `HTTP_PROXY`. A proxy
  would make its own DNS decision, which defeats pinning.

Defence in depth still applies: run outbound fetches from a network segment
without access to sensitive internal services, and on AWS require IMDSv2.

**Trade-offs made on purpose:** no connection pooling (a socket opened
by other code in your process could point anywhere, so it must never be
reused), and redirects are refused unless you ask for them.

## Compatibility

| Node.js | Status                  |
| ------- | ----------------------- |
| 26      | Tested                  |
| 24 LTS  | Tested                  |
| 22 LTS  | Tested (22.12 or later) |

## Security

Please report vulnerabilities privately; see [SECURITY.md](SECURITY.md).
Releases are published from GitHub Actions with npm provenance
(`npm audit signatures` verifies them).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE). Maintained by [Gydr.ai](https://gydr.ai).
