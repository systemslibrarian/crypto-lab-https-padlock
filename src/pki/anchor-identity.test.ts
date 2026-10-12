import 'reflect-metadata'
import { beforeAll, describe, expect, it } from 'vitest'
import * as x509 from '@peculiar/x509'
import { makeStore, validatePath } from './path'
import { webCrypto } from './parse'

const ROOT = 'CN=Anchor Identity Test Root'
const FOREIGN = 'CN=Untrusted Cross-Signing Issuer'
const AT = new Date('2026-10-11T00:00:00Z')
const BEFORE = new Date('2026-01-01T00:00:00Z')
const AFTER = new Date('2036-01-01T00:00:00Z')
const bytes = (buffer: ArrayBuffer): number[] => [...new Uint8Array(buffer)]
const keys = (): Promise<CryptoKeyPair> => webCrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
)

async function mint(
  subject: string, issuer: string, subjectKeys: CryptoKeyPair, issuerKeys: CryptoKeyPair,
  ca: boolean, serial: string, notAfter = AFTER,
): Promise<x509.X509Certificate> {
  return x509.X509CertificateGenerator.create({
    subject, issuer, serialNumber: serial, notBefore: BEFORE, notAfter,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    publicKey: subjectKeys.publicKey, signingKey: issuerKeys.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(ca, undefined, true),
      new x509.KeyUsagesExtension(ca ? x509.KeyUsageFlags.keyCertSign : x509.KeyUsageFlags.digitalSignature, true),
    ],
  }, webCrypto)
}

describe('trust anchors require the locally held name and public key', () => {
  let heldKeys: CryptoKeyPair, foreignKeys: CryptoKeyPair, attackerKeys: CryptoKeyPair, leafKeys: CryptoKeyPair
  let held: x509.X509Certificate
  let store: ReturnType<typeof makeStore>
  beforeAll(async () => {
    ;[heldKeys, foreignKeys, attackerKeys, leafKeys] = await Promise.all([keys(), keys(), keys(), keys()])
    held = await mint(ROOT, ROOT, heldKeys, heldKeys, true, '01')
    store = makeStore([{ pem: held.toString('pem'), why: 'Locally configured test anchor' }])
  })

  it('accepts a leaf genuinely signed by the held root', async () => {
    const leaf = await mint('CN=Valid Leaf', ROOT, leafKeys, heldKeys, false, '02')
    const result = await validatePath([leaf], store, AT)
    expect(result.trusted).toBe(true)
    expect(result.reachedAnchor).toBe(true)
    expect(result.steps.filter(s => s.fromStore)).toHaveLength(1)
    expect(bytes(result.steps.at(-1)!.cert.rawData)).toEqual(bytes(held.rawData))
  })

  it('rejects a different-key cross-signed top that copies the held root name', async () => {
    const top = await mint(ROOT, FOREIGN, attackerKeys, foreignKeys, true, '03')
    const leaf = await mint('CN=Attacker Leaf', ROOT, leafKeys, attackerKeys, false, '04')
    // Every supplied signature is genuine. The missing fact is authorization
    // by the configured key, rather than whether the attacker signed a leaf.
    expect(await top.verify({ publicKey: foreignKeys.publicKey }, webCrypto)).toBe(true)
    expect(await leaf.verify({ publicKey: top.publicKey }, webCrypto)).toBe(true)
    expect(await leaf.verify({ publicKey: held.publicKey }, webCrypto)).toBe(false)
    expect(bytes(top.publicKey.rawData)).not.toEqual(bytes(held.publicKey.rawData))
    const result = await validatePath([leaf, top], store, AT)
    expect(result.links.every(link => link.verified)).toBe(true)
    expect(result.trusted).toBe(false)
    expect(result.reachedAnchor).toBe(false)
    expect(result.anchorWhy).toBe('')
    expect(result.steps.some(step => step.fromStore)).toBe(false)
    expect(result.reason).toContain('public key')
  })

  it('still rejects a different-key self-issued top through signature verification', async () => {
    const top = await mint(ROOT, ROOT, attackerKeys, attackerKeys, true, '05')
    const leaf = await mint('CN=Attacker Leaf', ROOT, leafKeys, attackerKeys, false, '06')
    const result = await validatePath([leaf, top], store, AT)
    expect(result.trusted).toBe(false)
    expect(result.reachedAnchor).toBe(false)
    expect(result.links.at(-1)!.verified).toBe(false)
    expect(result.reason).toContain('does not check out')
  })

  it('accepts a same-key cross-signed top and reports the actual held certificate', async () => {
    const top = await mint(ROOT, FOREIGN, heldKeys, foreignKeys, true, '07')
    const leaf = await mint('CN=Valid Leaf', ROOT, leafKeys, heldKeys, false, '08')
    expect(bytes(top.rawData)).not.toEqual(bytes(held.rawData))
    expect(bytes(top.publicKey.rawData)).toEqual(bytes(held.publicKey.rawData))
    const result = await validatePath([leaf, top], store, AT)
    expect(result.trusted).toBe(true)
    expect(result.reachedAnchor).toBe(true)
    expect(result.anchorWhy).toBe('Locally configured test anchor')
    const anchor = result.steps.at(-1)!
    expect(anchor.fromStore).toBe(true)
    expect(anchor.role).toBe('root')
    expect(bytes(anchor.cert.rawData)).toEqual(bytes(held.rawData))
    expect(bytes(anchor.cert.rawData)).not.toEqual(bytes(top.rawData))
  })

  it('preserves rejection of an expired served cross-signed copy', async () => {
    const top = await mint(ROOT, FOREIGN, heldKeys, foreignKeys, true, '09', new Date('2026-10-01T00:00:00Z'))
    const leaf = await mint('CN=Valid Leaf', ROOT, leafKeys, heldKeys, false, '10')
    const result = await validatePath([leaf, top], store, AT)
    expect(result.trusted).toBe(false)
    expect(result.reason).toMatch(/expired|not valid/)
  })

  it('checks the held certificate date under the existing lab anchor-date policy', async () => {
    const expiredHeld = await mint(ROOT, ROOT, heldKeys, heldKeys, true, '11', new Date('2026-10-01T00:00:00Z'))
    const expiredStore = makeStore([{ pem: expiredHeld.toString('pem'), why: 'Expired local test anchor' }])
    const top = await mint(ROOT, FOREIGN, heldKeys, foreignKeys, true, '12')
    const leaf = await mint('CN=Valid Leaf', ROOT, leafKeys, heldKeys, false, '13')
    const result = await validatePath([leaf, top], expiredStore, AT)
    expect(result.trusted).toBe(false)
    expect(result.reason).toContain('expired on 2026-10-01')
    const anchor = result.steps.at(-1)!
    expect(bytes(anchor.cert.rawData)).toEqual(bytes(expiredHeld.rawData))
    expect(anchor.inDate).toBe(false)
  })
})
