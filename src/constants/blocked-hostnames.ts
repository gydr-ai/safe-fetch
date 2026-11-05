/**
 * Hostnames refused before any DNS lookup.
 *
 * `localhost` (and, separately, every `*.localhost` name) resolves to
 * loopback by RFC 6761 § 6.3; the others are cloud metadata services that
 * answer on link-local addresses some resolvers hand out.
 *
 * @internal
 */
export const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
])
