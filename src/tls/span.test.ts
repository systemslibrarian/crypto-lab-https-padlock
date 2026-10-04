import { describe, expect, it } from 'vitest'
import { encodeClientHello } from './clienthello'

/**
 * The declared span must match where the name really is, at EVERY length.
 *
 * The span is computed by adding fixed header widths to the extension's start,
 * which is correct and brittle: it is the kind of arithmetic that works for the
 * one hostname somebody tested and drifts for another. So this searches the
 * bytes for the name instead and compares, across every length from 1 to 200
 * and across lengths that cross a 1-byte-to-2-byte length-prefix boundary.
 */
describe('the declared SNI span is where the name actually is', () => {
  const R = new Uint8Array(32).fill(0x11)
  const K = new Uint8Array(32).fill(0x22)
  const S = new Uint8Array(32).fill(0x33)

  /**
   * Search for the name PRECEDED BY ITS OWN 2-BYTE LENGTH, not for the name
   * alone.
   *
   * A bare `indexOf(host)` is wrong, and wrong in a way that looks like an
   * encoder bug. At hostname length 97 the name's own length prefix encodes as
   * `00 61`, and `0x61` is the character `a` -- so a 97-byte run of `a` is
   * preceded by a 98th, and the search lands one byte early. The first version
   * of this test failed at exactly n=97 and the encoder was correct. Anchoring
   * on the length prefix removes the coincidence instead of dodging it with a
   * tamer hostname.
   */
  const findName = (bytes: Uint8Array, host: string): number => {
    const needle = String.fromCharCode((host.length >> 8) & 0xff, host.length & 0xff) + host
    const at = String.fromCharCode(...bytes).indexOf(needle)
    return at === -1 ? -1 : at + 2
  }

  it('agrees with a byte search at every hostname length', () => {
    for (let n = 1; n <= 200; n += 1) {
      // A name of exactly length n made of label-safe characters.
      const host = 'a'.repeat(n)
      const hello = encodeClientHello(host, R, K, S)
      const span = hello.spans.find((s) => s.label === 'server name')!
      expect(findName(hello.bytes, host), `length ${n}`).toBe(span.start)
      expect(span.length, `length ${n}`).toBe(n)
      expect(hello.hostnameInBytes, `length ${n}`).toBe(host)
    }
  })

  it('the n=97 length-prefix coincidence really exists, and is handled', () => {
    // Guarding the guard: if this ever stops being a collision, the comment
    // above becomes a story about a different encoder.
    const host = 'a'.repeat(97)
    const hello = encodeClientHello(host, R, K, S)
    const naive = String.fromCharCode(...hello.bytes).indexOf(host)
    const anchored = findName(hello.bytes, host)
    expect(anchored - naive).toBe(1)
    expect(anchored).toBe(hello.spans.find((s) => s.label === 'server name')!.start)
  })

  it('the cipher-suite span is where the suite ids actually are', () => {
    const hello = encodeClientHello('github.com', R, K, S)
    const span = hello.spans.find((s) => s.label === 'cipher suites')!
    // The span covers the 2-byte list length plus the ids; the first id starts
    // two bytes in.
    const at = span.start + 2
    expect(hello.bytes[at]).toBe(0x13)
    expect(hello.bytes[at + 1]).toBe(0x01)
  })

  it('every length prefix in the message describes its own contents', () => {
    for (const host of ['a.io', 'github.com', 'x'.repeat(120) + '.example']) {
      const b = encodeClientHello(host, R, K, S).bytes
      // Record length covers everything after the 5-byte record header.
      expect(((b[3]! << 8) | b[4]!), host).toBe(b.length - 5)
      // Handshake length covers everything after the 4-byte handshake header.
      expect(((b[6]! << 16) | (b[7]! << 8) | b[8]!), host).toBe(b.length - 9)
    }
  })
})
