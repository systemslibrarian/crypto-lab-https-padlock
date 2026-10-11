import { describe, expect, it } from 'vitest'
import { tamperSignature } from './break'
import { CAPTURED_AT } from './clock'
import { LAB_TRUST_STORE, PEM, SCENARIOS } from './fixtures'
import { parsePem } from './parse'
import { makeStore, validatePath } from './path'

const realChain = (): ReturnType<typeof parsePem>[] => SCENARIOS[0]!.chain.map(parsePem)

/**
 * The correct path accepts the good chain and rejects every bad one.
 *
 * brief.md names five bad chains: wrong name, expired, missing intermediate,
 * self-signed leaf, and a signature altered by one byte. Name matching is a
 * separate check with its own suite (hostname.test.ts), so the four the PATH
 * validator owns are here, each built by damaging the REAL chain rather than by
 * hand-writing a fixture that asserts its own answer.
 */
describe('the path validator rejects every bad chain', () => {
  it('rejects a chain whose intermediate is missing', async () => {
    const [leaf, , cross] = realChain()
    // Leaf straight to the cross-signed root: the server "forgot" the
    // intermediate. This is the single most common real misconfiguration.
    const result = await validatePath([leaf!, cross!], LAB_TRUST_STORE, CAPTURED_AT)
    expect(result.trusted).toBe(false)
    // The page must name the actual cause, not just fail.
    expect(result.reason).toContain('different names')
  })

  it('rejects a chain whose leaf signature was altered by one byte', async () => {
    const [, mid, cross] = realChain()
    const tampered = tamperSignature(PEM.ghLeaf)
    // It still parses -- that is deliberate, see break.ts.
    expect(tampered.subject).toBe(parsePem(PEM.ghLeaf).subject)
    const result = await validatePath([tampered, mid!, cross!], LAB_TRUST_STORE, CAPTURED_AT)
    expect(result.trusted).toBe(false)
    expect(result.reason).toContain('does not check out')
  })

  it('rejects an expired chain, with no cryptography changing', async () => {
    const chain = realChain()
    // The real leaf expires 2026-11-29. One day later, nothing else is
    // different and the padlock is gone.
    const after = new Date('2026-11-30T12:00:00Z')
    const result = await validatePath(chain, LAB_TRUST_STORE, after)
    expect(result.trusted).toBe(false)
    expect(result.reason).toContain('expired')
    // Proof that only the date mattered: every signature still verifies.
    expect(result.links.every((l) => l.verified)).toBe(true)
  })

  it('rejects a leaf that signed itself', async () => {
    const leaf = parsePem(PEM.toySelfSignedLeaf)
    const result = await validatePath([leaf], LAB_TRUST_STORE, CAPTURED_AT)
    expect(result.trusted).toBe(false)
    expect(result.reason).toContain('signed itself')
  })

  it('rejects a chain whose root is not in the trusted list', async () => {
    // The same attacker chain that validates against the lab's store fails
    // against a store that does not hold the toy root. Nothing about the
    // certificates changed; only what the list trusts did.
    const emptyish = makeStore([{ pem: PEM.storeUsertrust, why: 'vendor' }])
    const chain = SCENARIOS[1]!.chain.map(parsePem)
    const result = await validatePath(chain, emptyish, CAPTURED_AT)
    expect(result.trusted).toBe(false)
    expect(result.reason).toContain('nowhere left to go')

    // And it passes against the real store, so the only variable was trust.
    const trusted = await validatePath(chain, LAB_TRUST_STORE, CAPTURED_AT)
    expect(trusted.trusted).toBe(true)
  })

  it('rejects a parent that is not allowed to sign certificates', async () => {
    // The attacker leaf put where its own CA should be: a perfectly real
    // signature from a certificate with CA:FALSE carries no authority.
    const leaf = parsePem(PEM.toyAttackerLeaf)
    const result = await validatePath([leaf, leaf], LAB_TRUST_STORE, CAPTURED_AT)
    expect(result.trusted).toBe(false)
  })
})

describe('the walk reports where trust actually comes from', () => {
  it('the real chain walks to an anchor the server never sent', async () => {
    const r = await validatePath(realChain(), LAB_TRUST_STORE, CAPTURED_AT)
    // This is the whole of promise 3. github.com's served chain ends at a
    // CROSS-SIGNED copy of its root, whose own issuer -- USERTrust ECC -- is
    // not in the chain at all. The walk's last step is therefore a certificate
    // the device supplied and the wire never carried.
    expect(r.steps.length).toBe(4)
    expect(r.links.length).toBe(3)
    expect(r.steps.filter((s) => s.fromStore)).toHaveLength(1)
    expect(r.steps[3]!.fromStore).toBe(true)
    expect(r.steps[3]!.name).toContain('USERTrust')
    expect(r.trusted).toBe(true)
  })

  it('ends at a step that came from the trust store, not from the server', async () => {
    const result = await validatePath(realChain(), LAB_TRUST_STORE, CAPTURED_AT)
    const root = result.steps.find((s) => s.role === 'root')
    expect(root?.fromStore).toBe(true)
    // The reason the root is trusted is a policy decision, not a cryptographic
    // one, and the page has to say so in those terms.
    expect(result.anchorWhy).toContain('operating system or browser vendor')
    // And it must NOT claim anything about the reader's own machine: this lab
    // ships a copy of that list and cannot see theirs.
    expect(result.anchorWhy).not.toContain('your device')
  })
})
