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
 * Pull the hostname out of whatever the reader typed.
 *
 * A reader asked for "the address you think you are visiting" will paste
 * `https://github.com/` -- it is the thing in their address bar. Treating that
 * as a hostname made the name check fail and told them a browser would refuse
 * the connection, which is both wrong and the opposite of the lesson: a browser
 * extracts the host and matches THAT. Worse, the whole URL went into the SNI
 * exhibit, so the page showed a first message no browser would ever send.
 *
 * So the input is parsed the way a browser parses it: scheme stripped, userinfo
 * dropped, port dropped, path and query dropped. What is left is compared.
 * Anything that still is not a plain DNS name is refused by `isPlainDnsName`
 * rather than guessed at.
 */
export function hostFromInput(raw: string): string {
  let s = raw.trim()
  if (s === '') return ''
  // Scheme, if any.
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  // Anything before an @ is userinfo, not a host.
  const at = s.lastIndexOf('@')
  if (at !== -1) s = s.slice(at + 1)
  // Path, query or fragment ends the authority.
  s = s.split(/[/?#]/)[0] ?? ''
  // A bracketed IPv6 literal is not a DNS name; leave it intact and let
  // isPlainDnsName refuse it rather than mangling it into something plausible.
  if (s.startsWith('[')) return normalise(s)
  // Port.
  const colon = s.indexOf(':')
  if (colon !== -1) s = s.slice(0, colon)
  return normalise(s)
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
  // A browser matches the HOST, not the URL the reader typed. See hostFromInput.
  const clean = hostFromInput(address)
  if (!isPlainDnsName(clean)) {
    return { address: clean, matched: false, via: '', presented, wildcard: false }
  }
  for (const san of presented) {
    const { matched, wildcard } = matchesOne(clean, san)
    if (matched) return { address: clean, matched: true, via: san, presented, wildcard }
  }
  return { address: clean, matched: false, via: '', presented, wildcard: false }
}
