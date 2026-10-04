import { describe, expect, it } from 'vitest'
import { CAPTURED_AT } from './clock'
import { DEVICE_STORE, PEM, SCENARIOS } from './fixtures'
import { commonName, dnsNames, fingerprint, isCa, isSelfIssued, keyDescription, organization, parsePem } from './parse'
import { validatePath } from './path'

/**
 * Known-answer tests over the vendored bytes.
 *
 * These are KATs in the strict sense: the expected values were read out of the
 * certificates with `openssl x509` BEFORE this lab could parse them, and are
 * written here as literals. A parser that silently returned the wrong field
 * would disagree with openssl, not merely with itself.
 *
 * The real chain's expected values came from:
 *   openssl x509 -in certs/real-github-leaf.pem -noout -subject -issuer -dates -ext subjectAltName
 */
describe('KAT: the real github.com chain parses to its known values', () => {
  const leaf = parsePem(PEM.ghLeaf)

  it('leaf: subject, issuer, serial', () => {
    expect(commonName(leaf)).toBe('github.com')
    expect(leaf.issuer).toContain('Sectigo Public Server Authentication CA DV E36')
    expect(leaf.serialNumber.toLowerCase()).toBe('a59ebdb596751db7f5c095079613953c')
  })

  it('leaf: validity window, to the second', () => {
    expect(leaf.notBefore.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(leaf.notAfter.toISOString()).toBe('2026-11-29T23:59:59.000Z')
  })

  it('leaf: the SANs are exactly the two names github.com presented', () => {
    expect(dnsNames(leaf)).toEqual(['github.com', 'www.github.com'])
  })

  it('leaf: no organization -- which is what makes it domain-validated', () => {
    // The entire basis of non-promise 2. If this ever returns a company name,
    // the certificate was replaced with an OV or EV one and the lab's claim
    // about what it attests has to change with it.
    expect(organization(leaf)).toBe('')
  })

  it('leaf: a real P-256 key and not a CA', () => {
    expect(keyDescription(leaf)).toBe('elliptic curve (P-256)')
    expect(isCa(leaf)).toBe(false)
  })

  it('leaf: SHA-256 fingerprint matches openssl', async () => {
    // openssl x509 -in certs/real-github-leaf.pem -noout -fingerprint -sha256
    expect(await fingerprint(leaf)).toBe(
      '46b601ee08b418cf8a3a1ebfe670ba5ce43bb05a917fa8b2dd087a30471cfc63',
    )
  })

  it('intermediate: a CA, and it names its own validation level', () => {
    const mid = parsePem(PEM.ghIntermediate)
    expect(commonName(mid)).toBe('Sectigo Public Server Authentication CA DV E36')
    expect(isCa(mid)).toBe(true)
    expect(mid.notAfter.toISOString()).toBe('2036-03-21T23:59:59.000Z')
  })

  it('store anchor: the Sectigo root really is self-signed', () => {
    const root = parsePem(PEM.storeSectigo)
    expect(isSelfIssued(root)).toBe(true)
    expect(isCa(root)).toBe(true)
    expect(commonName(root)).toBe('Sectigo Public Server Authentication Root E46')
  })
})

describe('KAT: the toy hierarchy parses to its minted values', () => {
  it('the attacker leaf carries the attacker name and no organization', () => {
    const leaf = parsePem(PEM.toyAttackerLeaf)
    expect(commonName(leaf)).toBe('login.yourbank-security.example')
    expect(dnsNames(leaf)).toEqual(['login.yourbank-security.example'])
    expect(organization(leaf)).toBe('')
    expect(isCa(leaf)).toBe(false)
  })

  it('the toy hierarchy spans the fixed minted window', () => {
    const root = parsePem(PEM.toyRoot)
    expect(root.notBefore.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(root.notAfter.toISOString()).toBe('2036-01-01T00:00:00.000Z')
    expect(isSelfIssued(root)).toBe(true)
  })

  it('the self-signed leaf is its own issuer and is not a CA', () => {
    const leaf = parsePem(PEM.toySelfSignedLeaf)
    expect(isSelfIssued(leaf)).toBe(true)
    expect(isCa(leaf)).toBe(false)
  })
})

describe('the correct path accepts the good chains', () => {
  it('accepts the real github.com chain as of the capture instant', async () => {
    const chain = SCENARIOS[0]!.chain.map(parsePem)
    const result = await validatePath(chain, DEVICE_STORE, CAPTURED_AT)
    expect(result.reason).toBe('')
    expect(result.trusted).toBe(true)
    expect(result.reachedAnchor).toBe(true)
    // Every link verified in WebCrypto, not asserted.
    expect(result.links.every((l) => l.verified)).toBe(true)
  })

  it('accepts the attacker-name chain -- and that is the lesson', async () => {
    const chain = SCENARIOS[1]!.chain.map(parsePem)
    const result = await validatePath(chain, DEVICE_STORE, CAPTURED_AT)
    expect(result.trusted).toBe(true)
    expect(result.reason).toBe('')
  })
})
