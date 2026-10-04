import { describe, expect, it } from 'vitest'
import { assess, outcomeGlyph, type WireFacts } from './assess'
import { tamperSignature } from './break'
import { CAPTURED_AT } from './clock'
import { PEM, scenario } from './fixtures'

const WIRE: WireFacts = {
  hostnameInBytes: 'github.com',
  sniOffset: 97,
  cipherSuiteNames: ['TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256'],
}

const real = () => ({ scenario: scenario('github-real'), address: 'github.com', at: CAPTURED_AT })
const attacker = () => ({
  scenario: scenario('attacker-name'),
  address: 'login.yourbank-security.example',
  at: CAPTURED_AT,
})

describe('the four promises, computed', () => {
  it('all four pass on the real chain, and the padlock shows', async () => {
    const a = await assess(real(), WIRE)
    expect(a.promises.map((p) => p.id)).toEqual([
      'promise-key', 'promise-name', 'promise-vouched', 'promise-time',
    ])
    expect(a.promises.every((p) => p.outcome === 'pass')).toBe(true)
    expect(a.padlock.result).toBe('pass')
  })

  it('a wrong address fails only the name check', async () => {
    const a = await assess({ ...real(), address: 'evil.example' }, WIRE)
    const byId = new Map(a.promises.map((p) => [p.id, p.outcome]))
    expect(byId.get('promise-name')).toBe('fail')
    expect(byId.get('promise-vouched')).toBe('pass')
    expect(byId.get('promise-time')).toBe('pass')
    expect(a.padlock.result).toBe('fail')
  })

  it('a date past expiry fails only the time check, signatures intact', async () => {
    const a = await assess({ ...real(), at: new Date('2027-01-01T00:00:00Z') }, WIRE)
    const byId = new Map(a.promises.map((p) => [p.id, p.outcome]))
    expect(byId.get('promise-time')).toBe('fail')
    // The point of the exhibit: nothing cryptographic changed.
    expect(a.path.links.every((l) => l.verified)).toBe(true)
    expect(a.padlock.result).toBe('fail')
  })

  it('a one-bit signature flip fails only the vouching check', async () => {
    const a = await assess({ ...real(), tamperedLeaf: tamperSignature(PEM.ghLeaf) }, WIRE)
    const byId = new Map(a.promises.map((p) => [p.id, p.outcome]))
    expect(byId.get('promise-vouched')).toBe('fail')
    expect(byId.get('promise-name')).toBe('pass')
    expect(byId.get('promise-time')).toBe('pass')
  })
})

describe('the negative claim (4.1d): a valid certificate does not establish the operator', () => {
  it('returns "not established" on the real chain, where every check passes', async () => {
    const a = await assess(real(), WIRE)
    // Assertion 2's shape, in the unit layer: everything green...
    expect(a.promises.every((p) => p.outcome === 'pass')).toBe(true)
    // ...and the named property is not provided anyway.
    const operator = a.nonPromises.find((n) => n.id === 'nonpromise-operator')!
    expect(operator.outcome).toBe('not-established')
    expect(operator.evidence.find((e) => e.label === 'Operator identity')?.value).toBe('not established')
  })

  it('reads the empty organization field out of the real certificate', async () => {
    const a = await assess(real(), WIRE)
    const operator = a.nonPromises.find((n) => n.id === 'nonpromise-operator')!
    expect(operator.evidence.find((e) => e.label === 'Organization in certificate')?.value)
      .toContain('none')
  })

  it('stays "not established" on the attacker chain too', async () => {
    const a = await assess(attacker(), WIRE)
    expect(a.nonPromises.find((n) => n.id === 'nonpromise-operator')!.outcome)
      .toBe('not-established')
  })
})

describe('the attacker fixture: every check passes and the verdict is ALARM', () => {
  it('passes all four promises', async () => {
    const a = await assess(attacker(), WIRE)
    expect(a.promises.every((p) => p.outcome === 'pass')).toBe(true)
  })

  it('renders ALARM rather than a green success', async () => {
    const a = await assess(attacker(), WIRE)
    // The brief's VISUAL SEMANTICS requirement, asserted on the computed
    // verdict rather than on a colour: a correct result the reader is about to
    // misread must never read as success.
    expect(a.padlock.result).toBe('alarm')
    expect(a.padlock.result).not.toBe('pass')
  })

  it('names honesty as not established, with all checks passing', async () => {
    const a = await assess(attacker(), WIRE)
    const honest = a.nonPromises.find((n) => n.id === 'nonpromise-honest')!
    expect(honest.outcome).toBe('not-established')
    expect(honest.evidence.find((e) => e.label === 'All checks passed')?.value).toBe('yes')
  })
})

describe('the self-signed chain', () => {
  it('fails vouching and names self-signing as the cause', async () => {
    const a = await assess(
      { scenario: scenario('self-signed'), address: 'selfsigned.padlock.example', at: CAPTURED_AT },
      WIRE,
    )
    const vouched = a.promises.find((p) => p.id === 'promise-vouched')!
    expect(vouched.outcome).toBe('fail')
    expect(vouched.detail).toContain('signed itself')
    expect(a.padlock.result).toBe('fail')
  })
})

describe('every outcome has an icon and a word, not just a colour', () => {
  it('covers all four outcomes', () => {
    for (const o of ['pass', 'fail', 'not-established', 'out-of-scope'] as const) {
      const g = outcomeGlyph(o)
      expect(g.icon.length).toBeGreaterThan(0)
      expect(g.word.length).toBeGreaterThan(0)
    }
  })
})
