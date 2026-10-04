import type { NameMatch } from './types'

/**
 * Does the address in the browser's address bar match the name in the
 * certificate? RFC 6125, as the web actually applies it.
 *
 * Two rules matter, and the second is the one that surprises people:
 *
 *  1. The subjectAltName extension governs. The subject's Common Name is
 *     IGNORED -- not preferred-less-than-SAN, ignored. Chrome dropped the CN
 *     fallback in 58, Firefox in 48. A certificate with the right CN and the
 *     wrong SAN does not match, and this function will not pretend otherwise.
 *
 *  2. A wildcard matches EXACTLY ONE label, and only the leftmost one.
 *     `*.example.com` matches `www.example.com` and does not match
 *     `example.com` or `a.b.example.com`. That is the rule browsers enforce,
 *     and the reason `*.com` cannot exist.
 *
 * Comparison is on lowercase ASCII. Internationalised names are out of scope
 * for this lab, and a name carrying anything outside the DNS character set is
 * refused rather than guessed at -- see `isPlainDnsName`.
 */

/** Trailing dots are legal in DNS and absent from certificates. */
function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, '')
}

/**
 * Letters, digits, hyphen, dot. Deliberately strict: a name carrying anything
 * else -- a space, a slash, a non-ASCII character, an embedded NUL -- is not
 * something this lab will quietly normalise into a match. Fail closed.
 */
export function isPlainDnsName(name: string): boolean {
  const n = normalise(name)
  if (n.length === 0 || n.length > 253) return false
  return n.split('.').every((label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label))
}

/** One SAN entry against one address. Exported for its own unit tests. */
export function matchesOne(address: string, san: string): { matched: boolean; wildcard: boolean } {
  const a = normalise(address)
  const s = normalise(san)
  if (!s.startsWith('*.')) return { matched: a === s, wildcard: false }

  const suffix = s.slice(2)
  // `*.com` -- a wildcard over a public suffix -- is refused outright. So is a
  // wildcard with nothing after it.
  if (suffix.length === 0 || !suffix.includes('.')) return { matched: false, wildcard: true }
  if (!a.endsWith(`.${suffix}`)) return { matched: false, wildcard: true }
  // Exactly one label may stand where the star is.
  const stood = a.slice(0, a.length - suffix.length - 1)
  return { matched: stood.length > 0 && !stood.includes('.'), wildcard: true }
}

/**
 * The check promise 2 renders. `presented` is every DNS SAN the certificate
 * carries, so the page can show the reader what it compared against rather
 * than only the answer.
 */
export function matchName(address: string, presented: readonly string[]): NameMatch {
  const clean = normalise(address)
  if (!isPlainDnsName(clean)) {
    return { address: clean, matched: false, via: '', presented, wildcard: false }
  }
  for (const san of presented) {
    const { matched, wildcard } = matchesOne(clean, san)
    if (matched) return { address: clean, matched: true, via: san, presented, wildcard }
  }
  return { address: clean, matched: false, via: '', presented, wildcard: false }
}
