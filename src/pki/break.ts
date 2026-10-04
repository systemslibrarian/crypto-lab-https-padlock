import type * as x509 from '@peculiar/x509'
import { parsePem } from './parse'

/**
 * Break a certificate, for real.
 *
 * Flips one bit in the signature's last byte and re-parses. The result is a
 * genuine X.509 certificate whose signature is genuinely wrong -- not a flag
 * the validator is told to honour. Promise 3's "break it yourself" control
 * calls this, and the path validator then rejects it through the same WebCrypto
 * verify every other link goes through.
 *
 * The last byte is chosen because it is inside the DER-encoded ECDSA `s`
 * integer for every certificate this lab ships, so the flip lands in signature
 * material rather than in a length header, and the certificate still PARSES.
 * That distinction is the whole point: a certificate that fails to parse
 * teaches "this is not a certificate", and a certificate that parses with a bad
 * signature teaches "somebody changed this after it was signed".
 */
export function tamperSignature(pem: string): x509.X509Certificate {
  const original = parsePem(pem)
  const der = new Uint8Array(original.rawData)
  const copy = der.slice()
  copy[copy.length - 1] = copy[copy.length - 1]! ^ 0x01
  return parsePem(bytesToPem(copy))
}

/** DER back to PEM, so the tampered bytes re-enter through the same parser. */
export function bytesToPem(der: Uint8Array): string {
  let binary = ''
  for (const b of der) binary += String.fromCharCode(b)
  const b64 = btoa(binary).replace(/(.{64})/g, '$1\n').replace(/\n$/, '')
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`
}
