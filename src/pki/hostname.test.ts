import { describe, expect, it } from 'vitest'
import { hostFromInput, isPlainDnsName, matchesOne, matchName } from './hostname'

describe('RFC 6125 name matching', () => {
  it('matches an exact name, case-insensitively and past a trailing dot', () => {
    expect(matchesOne('github.com', 'github.com').matched).toBe(true)
    expect(matchesOne('GitHub.COM', 'github.com').matched).toBe(true)
    expect(matchesOne('github.com.', 'github.com').matched).toBe(true)
  })

  it('refuses a name the certificate does not carry', () => {
    expect(matchesOne('evil.com', 'github.com').matched).toBe(false)
    // A suffix is not a match: this is the shape of a real attack.
    expect(matchesOne('github.com.evil.com', 'github.com').matched).toBe(false)
    expect(matchesOne('notgithub.com', 'github.com').matched).toBe(false)
  })

  it('lets a wildcard stand for exactly one leftmost label', () => {
    expect(matchesOne('www.example.com', '*.example.com').matched).toBe(true)
    expect(matchesOne('shop.example.com', '*.example.com').matched).toBe(true)
    // The bare domain is NOT covered by its own wildcard.
    expect(matchesOne('example.com', '*.example.com').matched).toBe(false)
    // Two labels cannot stand where one star does.
    expect(matchesOne('a.b.example.com', '*.example.com').matched).toBe(false)
  })

  it('refuses a wildcard over a public suffix', () => {
    expect(matchesOne('github.com', '*.com').matched).toBe(false)
    expect(matchesOne('anything', '*.').matched).toBe(false)
    expect(matchesOne('x.y', '*').matched).toBe(false)
  })

  it('ignores the Common Name: only SANs are consulted', () => {
    // The real shape of crypto-lab-chain-of-trust's CN/SAN trap: a certificate
    // whose CN says www and whose SAN says shop matches shop, and not www.
    const m = matchName('www.example.com', ['shop.example.com'])
    expect(m.matched).toBe(false)
    expect(matchName('shop.example.com', ['shop.example.com']).matched).toBe(true)
  })

  it('reports which SAN matched, and whether it was a wildcard', () => {
    const exact = matchName('github.com', ['github.com', '*.github.com'])
    expect(exact.via).toBe('github.com')
    expect(exact.wildcard).toBe(false)

    const wild = matchName('deep.github.com', ['github.com', '*.github.com'])
    expect(wild.via).toBe('*.github.com')
    expect(wild.wildcard).toBe(true)
  })

  it('fails closed on anything that is not a plain DNS name', () => {
    for (const bad of ['', ' ', 'a b.com', 'héllo.com', 'a/b.com', 'a..b', '-x.com', 'x-.com']) {
      expect(isPlainDnsName(bad), bad).toBe(false)
      expect(matchName(bad, ['github.com']).matched, bad).toBe(false)
    }
    expect(isPlainDnsName('a'.repeat(254))).toBe(false)
  })
})

describe('what the reader actually types', () => {
  it('extracts the host from a pasted URL, the way a browser does', () => {
    for (const raw of [
      'https://github.com/',
      'http://github.com',
      'https://github.com/owner/repo?tab=readme#top',
      'https://github.com:443/',
      'github.com/owner/repo',
      '  HTTPS://GitHub.com/  ',
      'https://user:pw@github.com/private',
    ]) {
      expect(hostFromInput(raw), raw).toBe('github.com')
      expect(matchName(raw, ['github.com']).matched, raw).toBe(true)
    }
  })

  it('still refuses anything that is not a plain DNS name after extraction', () => {
    for (const raw of ['https://', 'https://[::1]/', 'https://a b.com/', '://x']) {
      expect(matchName(raw, ['github.com']).matched, raw).toBe(false)
    }
  })

  it('does not turn a different host into a match', () => {
    expect(matchName('https://github.com.evil.example/', ['github.com']).matched).toBe(false)
    expect(hostFromInput('https://evil.example/github.com')).toBe('evil.example')
  })
})
