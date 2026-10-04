import { describe, expect, it } from 'vitest'
import { encodeClientHello, freshClientHello } from './clienthello'

/**
 * The encoder is checked by an INDEPENDENT reader, not by the span arithmetic
 * that produced it.
 *
 * `readSniByWalking` below navigates the TLS structure properly -- record
 * header, handshake header, the variable-length session id, the cipher list,
 * the compression list, then the extension vector -- and finds the server_name
 * extension by its type code. It shares no arithmetic with the encoder's
 * `spans`. If the encoder's byte offsets were wrong, or its length prefixes
 * disagreed with its contents, this walk lands somewhere else and the test
 * fails. That is the difference between a test that agrees with a bug and one
 * that catches it.
 */
function readSniByWalking(bytes: Uint8Array): { host: string; suites: number[] } {
  let i = 0
  const u8 = (): number => bytes[i++]!
  const u16 = (): number => (u8() << 8) | u8()

  expect(u8(), 'record type must be handshake(22)').toBe(0x16)
  i += 2 // legacy record version
  const recordLen = u16()
  expect(recordLen, 'record length must cover the rest exactly').toBe(bytes.length - i)

  expect(u8(), 'handshake type must be client_hello(1)').toBe(0x01)
  const hsLen = (u8() << 16) | (u8() << 8) | u8()
  expect(hsLen, 'handshake length must cover the rest exactly').toBe(bytes.length - i)

  i += 2 // legacy_version
  i += 32 // random
  // `i += u8()` would be wrong: += captures i BEFORE the reader advances it,
  // so the length byte itself is skipped twice and the walk lands one byte
  // short. Sequence it explicitly.
  const sessionIdLen = u8()
  i += sessionIdLen
  const suiteBytes = u16()
  const suites: number[] = []
  for (let k = 0; k < suiteBytes; k += 2) suites.push(u16())
  const compressionLen = u8()
  i += compressionLen

  const extTotal = u16()
  const extEnd = i + extTotal
  let host = ''
  while (i < extEnd) {
    const type = u16()
    const len = u16()
    const body = i
    if (type === 0x0000) {
      let j = body
      j += 2 // server_name_list length
      expect(bytes[j], 'name_type must be host_name(0)').toBe(0x00)
      j += 1
      const nameLen = (bytes[j]! << 8) | bytes[j + 1]!
      j += 2
      host = String.fromCharCode(...bytes.slice(j, j + nameLen))
    }
    i = body + len
  }
  expect(i, 'the extension vector must end exactly where its length said').toBe(extEnd)
  return { host, suites }
}

const RANDOM = new Uint8Array(32).fill(0xa1)
const SHARE = new Uint8Array(32).fill(0xb2)
const SESSION = new Uint8Array(32).fill(0xc3)

describe('TLS 1.3 ClientHello encoding (RFC 8446 4.1.2, RFC 6066 3)', () => {
  it('a structural walk finds the hostname the encoder claims it placed', () => {
    const hello = encodeClientHello('github.com', RANDOM, SHARE, SESSION)
    const walked = readSniByWalking(hello.bytes)
    expect(walked.host).toBe('github.com')
    // The encoder's own span, read back from the bytes, agrees with the walk.
    expect(hello.hostnameInBytes).toBe(walked.host)
  })

  it('the hostname is readable ASCII in the raw bytes -- that is non-promise 3', () => {
    const hello = encodeClientHello('login.yourbank-security.example', RANDOM, SHARE, SESSION)
    const asText = String.fromCharCode(...hello.bytes)
    expect(asText).toContain('login.yourbank-security.example')
    const walked = readSniByWalking(hello.bytes)
    expect(walked.host).toBe('login.yourbank-security.example')
  })

  it('the cipher list is in the clear, and it is the list the page names', () => {
    const hello = encodeClientHello('github.com', RANDOM, SHARE, SESSION)
    const walked = readSniByWalking(hello.bytes)
    expect(walked.suites).toEqual([0x1301, 0x1302, 0x1303])
    expect(hello.cipherSuiteNames).toEqual([
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
    ])
  })

  it('every declared span lands inside the buffer', () => {
    const hello = encodeClientHello('github.com', RANDOM, SHARE, SESSION)
    expect(hello.spans.length).toBeGreaterThan(0)
    for (const s of hello.spans) {
      expect(s.start, s.label).toBeGreaterThanOrEqual(0)
      expect(s.start + s.length, s.label).toBeLessThanOrEqual(hello.bytes.length)
      expect(s.length, s.label).toBeGreaterThan(0)
    }
  })

  it('the random span really holds the random we passed in', () => {
    const hello = encodeClientHello('github.com', RANDOM, SHARE, SESSION)
    const span = hello.spans.find((s) => s.label === 'random')!
    expect([...hello.bytes.slice(span.start, span.start + span.length)]).toEqual([...RANDOM])
  })

  it('name length changes move the later spans with it', () => {
    // A fixed offset that happened to work for one hostname is the obvious way
    // to get this wrong, so it is tested across lengths.
    for (const host of ['a.io', 'github.com', 'login.yourbank-security.example', 'x'.repeat(60) + '.example']) {
      const hello = encodeClientHello(host, RANDOM, SHARE, SESSION)
      expect(readSniByWalking(hello.bytes).host, host).toBe(host)
      expect(hello.hostnameInBytes, host).toBe(host)
    }
  })

  it('refuses a random or key share of the wrong size', () => {
    expect(() => encodeClientHello('a.io', new Uint8Array(31), SHARE, SESSION)).toThrow(/32 bytes/)
    expect(() => encodeClientHello('a.io', RANDOM, new Uint8Array(16), SESSION)).toThrow(/32 bytes/)
  })

  it('the browser path produces a structurally valid message too', () => {
    const hello = freshClientHello('github.com')
    expect(readSniByWalking(hello.bytes).host).toBe('github.com')
  })
})
