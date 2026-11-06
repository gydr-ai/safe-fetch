<h1 align="center">@gydr-ai/safe-fetch</h1>

<p align="center">
  <strong><code>fetch</code> for URLs you do not control.</strong><br />
  SSRF protection for Node.js that holds up against DNS rebinding, sneaky
  redirects and every way of writing an internal address.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@gydr-ai/safe-fetch"><img alt="npm" src="https://img.shields.io/npm/v/@gydr-ai/safe-fetch" /></a>
  <a href="https://github.com/gydr-ai/safe-fetch/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/gydr-ai/safe-fetch/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/gydr-ai/safe-fetch"><img alt="OpenSSF Scorecard" src="https://api.scorecard.dev/projects/github.com/gydr-ai/safe-fetch/badge" /></a>
  <img alt="Node.js 22.12+" src="https://img.shields.io/node/v/@gydr-ai/safe-fetch" />
  <img alt="Zero dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen" />
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue" /></a>
</p>

<p align="center">
  <sub>Built and maintained by <a href="https://gydr.ai"><strong>Gydr</strong></a></sub>
</p>

---

AI agents, MCP servers, webhook senders, link previewers and crawlers all
fetch URLs that come from users, configuration or a language model. Any of
them can point the request back into your own network: a cloud metadata
service, an admin page, `localhost`. That is Server-Side Request Forgery
([CWE-918](https://cwe.mitre.org/data/definitions/918.html)).

`safeFetch` is a drop-in `fetch` that refuses those requests.

## Why not just check the URL?

A check on the URL text, or a DNS lookup before calling `fetch`, misses most
real attacks:

| Attack                                                       | URL or DNS check alone | `safeFetch`                     |
| ------------------------------------------------------------ | ---------------------- | ------------------------------- |
| `http://2130706433/` (`127.0.0.1` as one number)             | Often passes           | Refused                         |
| `https://[::ffff:169.254.169.254]/` (IPv4 inside IPv6)       | Often passes           | Refused                         |
| A public name whose DNS answers with a private address       | Passes a text check    | Refused                         |
| DNS rebinding: public at check time, private at connect time | Passes                 | Socket pinned to checked IP     |
| A public URL that redirects to `http://localhost/admin`      | Passes                 | Redirects refused or re-checked |
| A 1 KB response that inflates to gigabytes                   | Not covered            | Capped after decompression      |
| A server that sends one byte a minute                        | Not covered            | One deadline for everything     |

## Highlights

- **Every internal address, every notation.** Private, loopback,
  link-local, reserved and metadata ranges in IPv4 and IPv6, including
  IPv4 hidden inside IPv6 (`[::ffff:127.0.0.1]`, NAT64, 6to4) and the
  shorthand forms URL parsers accept (`127.1`, `2130706433`, `0x7f.1`).
- **No DNS-rebinding window.** The hostname is resolved once, _every_
  address is checked, and the socket connects to exactly the address that
  was checked. `Host` and TLS certificate checks still use the real name.
- **Redirects are new requests.** Refused unless you opt in; when followed,
  each hop is checked from scratch and credentials are dropped when the
  origin changes.
- **Bounded cost.** One deadline for the whole exchange, and one size cap
  counted _after_ decompression, so slow drips and compression bombs stop.
- **Safely extensible.** Your own resolver, ranges, hostname rules, headers
  and hooks, none of which can switch a protection off.
- **Zero runtime dependencies.** A single minified ES module with source
  maps and full type declarations.

## Contents

- [Why not just check the URL?](#why-not-just-check-the-url)
- [Install](#install)
- [Quick start](#quick-start)
- [Guides](#guides)
- [API](#api)
- [What is blocked](#what-is-blocked)
- [Security model](#security-model)
- [Compatibility](#compatibility)
- [Security](#security)
- [About Gydr](#about-gydr)

## Install

```bash
npm install @gydr-ai/safe-fetch
```

Node.js 22.12 or later. ES modules only.

## Quick start

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
    console.warn("refused:", error.reason) // e.g. "blocked_address"
  } else if (error instanceof SafeFetchError) {
    console.warn("failed:", error.code) // e.g. "timeout"
  } else {
    throw error
  }
}
```

You get a standard `Response`: `.ok`, `.status`, `.headers`, `.json()`,
`.text()` and `.body` all work as usual.

## Guides

### Validate a URL when it is saved

Call `assertSafeUrl` when someone saves a URL (a webhook endpoint, a plugin
address) so they get an immediate, specific error. It never touches the
network.

```ts
import { assertSafeUrl, UnsafeUrlError } from "@gydr-ai/safe-fetch"

try {
  assertSafeUrl(body.webhookUrl, { label: "Webhook URL" })
} catch (error) {
  if (error instanceof UnsafeUrlError) {
    return badRequest({ field: "webhookUrl", code: error.reason })
  }
  throw error
}
```

Still use `safeFetch` when you deliver: a name that was public when it was
saved can point somewhere private later.

### Configure an instance

`createSafeFetch(config)` returns a `safeFetch` with your own defaults and
rules. The plain `safeFetch` export is `createSafeFetch()`.

```ts
import { createSafeFetch } from "@gydr-ai/safe-fetch"

const fetchPartner = createSafeFetch({
  timeoutMs: 5_000,
  maxResponseBytes: 1024 * 1024,
  label: "Partner URL",
  allowedHostnames: ["api.partner.example", "*.cdn.partner.example"],
  headers: { "user-agent": "my-app/1.0" },
  stripHeadersOnCrossOrigin: ["x-api-key"],
  onResponse: ({ url, status }) => metrics.count(url.host, status),
})

const response = await fetchPartner("https://api.partner.example/v1/items")
```

Every extension point can only **tighten** or **observe**. None can skip
the address check, the socket pin, the per-hop redirect check, credential
stripping, the deadline, the size cap, or the status and encoding guards.
The single deliberate exception is `allowedRanges`, described below. The
configuration is validated (a bad value throws a `TypeError` immediately;
per-call options are checked the same way before anything is sent), only
its own properties are read (never inherited ones), and it is copied, so
editing the object afterwards changes nothing.

### Reach one internal network on purpose

Some services must fetch from one internal range, an intranet crawler for
example. Allow exactly that range and nothing else:

```ts
const fetchIntranet = createSafeFetch({
  allowedRanges: ["10.20.0.0/16"],
  allowedHostnames: ["*.intranet.example"],
})
```

Keep the range as narrow as you can, and never include one that holds a
metadata service.

### When another library owns the socket

`resolveSafeUrl` checks a URL and every address it currently resolves to.
Use it only when a request cannot go through `safeFetch`, such as inside a
vendor SDK. That library resolves the name again, so a rebinding window
remains: prefer `safeFetch` wherever you can.

## API

| Export                                  | Purpose                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `safeFetch(input, init?, options?)`     | The guarded `fetch`. Returns a `Response`.                              |
| `createSafeFetch(config?)`              | A `safeFetch` with your own defaults, rules and hooks.                  |
| `assertSafeUrl(input, policy?)`         | Validate a URL without the network. Returns the parsed `URL`.           |
| `resolveSafeUrl(input, policy?)`        | Validate a URL and every address it resolves to.                        |
| `isBlockedAddress(address)`             | The built-in decision for one IP address.                               |
| `createAddressPolicy(options?)`         | That decision with your own extra and allowed ranges.                   |
| `SafeFetchError`, `UnsafeUrlError`      | The two error classes (see [Errors](#errors)).                          |
| `SafeFetchErrorCode`, `UnsafeUrlReason` | Frozen objects of the stable error codes, for `switch` and comparisons. |

### Options

Pass these as the third argument to `safeFetch`, or as defaults to
`createSafeFetch`. A per-call value wins over the default.

| Option             | Default | Meaning                                                                  |
| ------------------ | ------- | ------------------------------------------------------------------------ |
| `allowHttp`        | `false` | Accept `http:` as well as `https:`.                                      |
| `allowedPorts`     | any     | Only connect to these ports, e.g. `[443]`.                               |
| `maxLength`        | `2048`  | Refuse longer URLs.                                                      |
| `timeoutMs`        | `15000` | One deadline for DNS, connecting, every redirect and reading the body.   |
| `maxResponseBytes` | 10 MiB  | Largest body accepted, counted after decompression.                      |
| `maxRedirects`     | `5`     | Hops followed when `init.redirect` is `"follow"`.                        |
| `decompress`       | `true`  | Decode `gzip`, `deflate` and `br`, up to two layers. Others are refused. |
| `label`            | `"URL"` | Name used in error messages, e.g. `"Webhook URL"`.                       |

`assertSafeUrl` and `resolveSafeUrl` take `allowHttp`, `allowedPorts`,
`maxLength` and `label`.

### Configuration

Everything `createSafeFetch` accepts, in addition to the options above.

| Field                       | Meaning                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `blockedRanges`             | Extra CIDR ranges to refuse, also matched against IPv4 inside IPv6. A blocked range wins over an allowed one.     |
| `allowedRanges`             | CIDR ranges to permit although the built-in list refuses them. Weakens protection: keep it narrow.                |
| `blockedHostnames`          | Extra hostnames to refuse: exact (`api.example.com`) or subdomains (`*.example.com`, not the apex). IDNs allowed. |
| `allowedHostnames`          | An allow-list in the same syntax, applied to every hop. An empty list refuses everything.                         |
| `headers`                   | Default request headers. A per-call header of the same name wins.                                                 |
| `stripHeadersOnCrossOrigin` | Extra headers dropped on a cross-origin redirect, on top of `Authorization`, `Cookie` and `Proxy-Authorization`.  |
| `lookup`                    | Your own resolver, `(hostname) => Promise<{ address, family }[]>`. Its answers are still checked and pinned.      |

### Hooks

| Hook         | Called                                       | Can                                    |
| ------------ | -------------------------------------------- | -------------------------------------- |
| `onResolve`  | After a hostname's addresses pass the policy | Return `false` to refuse the host.     |
| `onRedirect` | After a redirect target passes the policy    | Return `false` to refuse the redirect. |
| `onRequest`  | Just before each hop is sent                 | Observe `url`, `method`, `addresses`.  |
| `onResponse` | When each hop's response headers arrive      | Observe `url`, `status`.               |

Hooks are synchronous and receive frozen copies, so changing their input
changes nothing. They never see request bodies, header values or response
bodies. A hook that throws, returns a promise, or (for a decision hook)
returns anything but `true`, `false` or nothing fails the request with
`hook_failed`: a mistaken hook refuses rather than allows.

### Differences from `fetch`

- `redirect` defaults to `"error"`. Use `"follow"` to follow (each hop is
  re-checked) or `"manual"` to receive the 3xx response. Any other value
  is a `TypeError`.
- `body` may be a string, `URLSearchParams`, `ArrayBuffer`, typed array or
  `Blob`. Streams and `FormData` are refused.
- `signal` works alongside `timeoutMs`; whichever fires first wins.
- `CONNECT`, `TRACE`, `TRACK` and invalid method names are refused.
  Transport headers (`Host`, `Connection`, `Transfer-Encoding` …) are set
  by the library.
- Credentials in custom headers (`X-Api-Key` and similar) follow a
  cross-origin redirect, as with `fetch`. Name them in
  `stripHeadersOnCrossOrigin`, or keep `redirect: "error"`.
- No connection pooling, no proxy, no cookies.

### Errors

`UnsafeUrlError.reason`: the URL, or an address it resolved to, is refused.

| Reason                 | When                                             |
| ---------------------- | ------------------------------------------------ |
| `url_too_long`         | Longer than `maxLength`.                         |
| `malformed_url`        | Not a parseable URL, or an empty label (`a..b`). |
| `protocol_not_allowed` | Not `https:` (or `http:` with `allowHttp`).      |
| `credentials_in_url`   | Contains a username or password.                 |
| `port_not_allowed`     | Port outside `allowedPorts`.                     |
| `blocked_address`      | A blocked host, address or range, on any hop.    |

`SafeFetchError.code`: the request could not be completed safely.

| Code                   | When                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `dns_failure`          | The hostname does not resolve, or `lookup` answered badly.  |
| `timeout`              | `timeoutMs` passed.                                         |
| `redirect_not_allowed` | A redirect arrived in `"error"` mode, or a hook refused it. |
| `too_many_redirects`   | More than `maxRedirects` hops.                              |
| `response_too_large`   | The body passed `maxResponseBytes`.                         |
| `unsupported_body`     | The request body type is not supported.                     |
| `unsupported_method`   | `CONNECT`, `TRACE`, `TRACK` or an invalid method.           |
| `unsupported_encoding` | A response encoding that cannot be decoded and counted.     |
| `network_error`        | Connection failure, invalid status or truncated body.       |
| `hook_failed`          | A hook threw or returned something invalid.                 |

When your own `signal` aborts, its `reason` is thrown as with `fetch` (a
reason that is not an `Error` is wrapped, keeping it as `cause`). A failure
while reading the body rejects that read and closes the connection at once;
so does cancelling `response.body`.

## What is blocked

Refused wherever it appears: in the URL or in any DNS answer, on any hop.

**IPv4** &nbsp; `0.0.0.0/8` · `10.0.0.0/8` · `100.64.0.0/10` ·
`127.0.0.0/8` · `169.254.0.0/16` · `172.16.0.0/12` · `192.0.0.0/24` ·
`192.0.2.0/24` · `192.88.99.0/24` · `192.168.0.0/16` · `198.18.0.0/15` ·
`198.51.100.0/24` · `203.0.113.0/24` · `224.0.0.0/4` · `240.0.0.0/4`

**IPv6** &nbsp; everything outside global unicast `2000::/3`, plus
`2001::/23` (incl. Teredo), `2001:db8::/32` and `3fff::/20` inside it.

**IPv4 inside IPv6** &nbsp; IPv4-mapped, NAT64 (`64:ff9b::/96`) and 6to4
(`2002::/16`) addresses are unwrapped and judged as IPv4, so public IPv4
over NAT64 still works.

**Names** &nbsp; `localhost` · `*.localhost` · `metadata` ·
`metadata.google.internal` · `metadata.goog` · `instance-data` ·
`instance-data.ec2.internal`

## Security model

**Protects against**

- user, configuration or model-supplied URLs reaching internal services or
  cloud metadata;
- DNS rebinding between the check and the connection;
- redirects into internal space, and credential leaks on redirect;
- oversized, compression-bomb and never-ending responses.

**Does not protect against**

- internal services on _public_ IP addresses: block those at the network
  layer as well;
- a hostile public server, beyond bounding its cost to you;
- proxies: `safeFetch` connects directly and ignores `HTTP_PROXY`, because
  a proxy would make its own DNS decision.

Defence in depth still applies: run outbound fetches from a network segment
that cannot reach sensitive services, and require session tokens on your
cloud metadata service.

## Compatibility

| Node.js | Status                        |
| ------- | ----------------------------- |
| 26      | Tested in CI                  |
| 24 LTS  | Tested in CI                  |
| 22 LTS  | Tested in CI (22.12 or later) |

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
Please do not open a public issue for a vulnerability.

Every release is built and published by GitHub Actions with
[npm provenance](https://docs.npmjs.com/generating-provenance-statements),
and a maintainer approves each one with a hardware security key. Verify what
you installed with:

```bash
npm audit signatures
```

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the development setup and the checks a change must pass.

## About Gydr

`@gydr-ai/safe-fetch` is built and maintained by [Gydr](https://gydr.ai), an
AI chatbot platform that answers customers on websites, WhatsApp, Messenger,
Instagram and Telegram. Our agents fetch URLs that customers and language
models supply; this package grew out of the guard that keeps those requests
out of our own network. See also [`@gydr-ai/mcp-oauth`](https://github.com/gydr-ai/mcp-oauth),
OAuth 2.1 for remote MCP servers.

## License

[Apache-2.0](LICENSE) © [Gydr.ai](https://gydr.ai)

<p align="center">
  <a href="https://gydr.ai"><img alt="Gydr" src="https://img.shields.io/badge/made_by-Gydr-0f172a?style=for-the-badge" /></a>
</p>
