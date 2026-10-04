/**
 * Encode a real TLS 1.3 ClientHello.
 *
 * RFC 8446 section 4.1.2 for the message, RFC 6066 section 3 for the
 * server_name extension. Hand-rolled on purpose: non-promises 3 and 4 are
 * claims about what is readable in the first packet of a connection, and a
 * claim like that is only worth the bytes it is read from. A library that
 * returned an opaque buffer would make this lab assert what it is supposed to
 * show.
 *
 * Nothing here is sent anywhere. The lab has no network -- it encodes the
 * message a browser would send, which is what lets the reader find the hostname
 * in it with their own eyes.
 *
 * The one thing that is NOT real: the random and the key share are drawn from
 * WebCrypto's real CSPRNG, but no handshake follows them, so they are real
 * random bytes rather than a real key exchange. The page says so. The SNI and
 * the cipher list -- the two fields the non-promises are about -- are byte-for-
 * byte what a browser puts on the wire.
 */

/** Where a named field landed in the encoded bytes, so the UI can point at it. */
export interface Span {
  readonly label: string
  readonly start: number
  readonly length: number
  /** Plain-language note shown when the reader highlights this span. */
  readonly note: string
}

export interface ClientHello {
  readonly bytes: Uint8Array
  readonly spans: readonly Span[]
  /** The hostname as it appears IN the bytes, recovered by re-reading them. */
  readonly hostnameInBytes: string
  readonly cipherSuiteNames: readonly string[]
}

/* The suites a current browser offers for TLS 1.3, in a browser's order. */
const CIPHER_SUITES: readonly { id: number; name: string }[] = [
  { id: 0x1301, name: 'TLS_AES_128_GCM_SHA256' },
  { id: 0x1302, name: 'TLS_AES_256_GCM_SHA384' },
  { id: 0x1303, name: 'TLS_CHACHA20_POLY1305_SHA256' },
]

class Writer {
  private out: number[] = []

  u8(v: number): this { this.out.push(v & 0xff); return this }

  u16(v: number): this { this.out.push((v >> 8) & 0xff, v & 0xff); return this }

  u24(v: number): this { this.out.push((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff); return this }

  raw(bytes: ArrayLike<number>): this { for (let i = 0; i < bytes.length; i += 1) this.out.push(bytes[i]! & 0xff); return this }

  ascii(s: string): this { for (const ch of s) this.out.push(ch.charCodeAt(0) & 0xff); return this }

  get length(): number { return this.out.length }

  bytes(): Uint8Array { return new Uint8Array(this.out) }
}

/** A length-prefixed block, where the prefix is written after the body. */
function block(width: 1 | 2 | 3, body: (w: Writer) => void): Uint8Array {
  const inner = new Writer()
  body(inner)
  const b = inner.bytes()
  const out = new Writer()
  if (width === 1) out.u8(b.length)
  else if (width === 2) out.u16(b.length)
  else out.u24(b.length)
  out.raw(b)
  return out.bytes()
}

/**
 * Build the ClientHello for `hostname`.
 *
 * `random` and `keyShare` are injected rather than generated inside, so a test
 * can pin them and assert exact bytes -- a KAT over the encoder. The browser
 * path passes real WebCrypto randomness.
 */
export function encodeClientHello(
  hostname: string,
  random: Uint8Array,
  keyShare: Uint8Array,
  sessionId: Uint8Array,
): ClientHello {
  if (random.length !== 32) throw new Error('ClientHello.random is 32 bytes (RFC 8446 4.1.2)')
  if (keyShare.length !== 32) throw new Error('an x25519 key share is 32 bytes (RFC 8446 4.2.8)')

  const spans: Span[] = []
  const w = new Writer()

  // ── Record header: handshake, "TLS 1.0" for middlebox compatibility ─────
  w.u8(0x16)
  w.u16(0x0301)
  const recordLenAt = w.length
  w.u16(0) // patched at the end

  const bodyStart = w.length

  // ── Handshake header: client_hello(1), 3-byte length ────────────────────
  w.u8(0x01)
  const hsLenAt = w.length
  w.u24(0)
  const hsStart = w.length

  // legacy_version: TLS 1.2. TLS 1.3 announces itself in an extension.
  w.u16(0x0303)

  spans.push({
    label: 'random',
    start: w.length,
    length: 32,
    note: '32 random bytes your browser just generated. Real randomness, and it reveals nothing about you.',
  })
  w.raw(random)

  w.raw(block(1, (b) => b.raw(sessionId)))

  // ── Cipher suites: non-promise 4's exhibit ──────────────────────────────
  const suitesBytes = block(2, (b) => { for (const s of CIPHER_SUITES) b.u16(s.id) })
  spans.push({
    label: 'cipher suites',
    start: w.length,
    length: suitesBytes.length,
    note: 'The list of encryption methods your browser is willing to use. In the clear, and not signed by anyone -- at this moment in the connection nobody has proved who they are yet.',
  })
  w.raw(suitesBytes)

  w.raw(block(1, (b) => b.u8(0x00))) // compression: null only, in TLS 1.3

  // ── Extensions ──────────────────────────────────────────────────────────
  const extStart = w.length
  const sniInner = block(2, (host) => {
    host.u8(0x00) // name_type: host_name
    host.raw(block(2, (n) => n.ascii(hostname)))
  })
  const extensions = new Writer()

  // server_name (0), RFC 6066. The field this lab exists to show you.
  extensions.u16(0x0000)
  const sniBody = block(2, (b) => b.raw(sniInner))
  extensions.raw(sniBody)

  // supported_versions (43): this is where TLS 1.3 is actually declared.
  extensions.u16(0x002b)
  extensions.raw(block(2, (b) => b.raw(block(1, (v) => v.u16(0x0304)))))

  // supported_groups (10): x25519.
  extensions.u16(0x000a)
  extensions.raw(block(2, (b) => b.raw(block(2, (g) => g.u16(0x001d)))))

  // key_share (51): a real 32-byte x25519 share.
  extensions.u16(0x0033)
  extensions.raw(
    block(2, (b) =>
      b.raw(
        block(2, (ks) => {
          ks.u16(0x001d)
          ks.raw(block(2, (k) => k.raw(keyShare)))
        }),
      ),
    ),
  )

  const extBytes = block(2, (b) => b.raw(extensions.bytes()))
  w.raw(extBytes)

  // The SNI span, located in the final buffer. `+2` for the extension type,
  // then the extension's own 2-byte length, the list length, the name type and
  // the name length: the hostname's ASCII starts 9 bytes into the extension.
  const sniExtStart = extStart + 2
  spans.push({
    label: 'server name',
    start: sniExtStart + 2 + 2 + 2 + 1 + 2,
    length: hostname.length,
    note: 'The name of the site you are visiting, in plain ASCII, before any encryption exists. Anyone on the path can read it.',
  })

  // ── Patch the two lengths ───────────────────────────────────────────────
  const bytes = w.bytes()
  const hsLen = bytes.length - hsStart
  bytes[hsLenAt] = (hsLen >> 16) & 0xff
  bytes[hsLenAt + 1] = (hsLen >> 8) & 0xff
  bytes[hsLenAt + 2] = hsLen & 0xff
  const recordLen = bytes.length - bodyStart
  bytes[recordLenAt] = (recordLen >> 8) & 0xff
  bytes[recordLenAt + 1] = recordLen & 0xff

  // Recover the hostname by READING the bytes back, rather than returning the
  // argument. If the encoder put it somewhere else, or the span is wrong, this
  // disagrees -- which is what makes the page's "the name is right there" claim
  // a measurement instead of a restatement.
  const span = spans.find((s) => s.label === 'server name')!
  const hostnameInBytes = String.fromCharCode(
    ...bytes.slice(span.start, span.start + span.length),
  )

  return {
    bytes,
    spans,
    hostnameInBytes,
    cipherSuiteNames: CIPHER_SUITES.map((s) => s.name),
  }
}

/** A ClientHello with real WebCrypto randomness, for the browser. */
export function freshClientHello(hostname: string): ClientHello {
  const random = new Uint8Array(32)
  const keyShare = new Uint8Array(32)
  const sessionId = new Uint8Array(32)
  globalThis.crypto.getRandomValues(random)
  globalThis.crypto.getRandomValues(keyShare)
  globalThis.crypto.getRandomValues(sessionId)
  return encodeClientHello(hostname, random, keyShare, sessionId)
}
