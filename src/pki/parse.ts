import * as x509 from '@peculiar/x509'
import type { Validity } from './types'

// Real WebCrypto everywhere: window.crypto in the browser, globalThis.crypto
// under Vitest. @peculiar/x509 verifies real DER TBS bytes with real ECDSA
// through this provider. Nothing here is simulated.
export const webCrypto = globalThis.crypto
x509.cryptoProvider.set(webCrypto)

/** Parse one PEM certificate. Throws on anything that is not one. */
export function parsePem(pem: string): x509.X509Certificate {
  return new x509.X509Certificate(pem)
}

/** Every DNS name in the subjectAltName extension. Empty when there is none. */
export function dnsNames(cert: x509.X509Certificate): string[] {
  const ext = cert.getExtension(x509.SubjectAlternativeNameExtension)
  if (!ext) return []
  return [...ext.names.items]
    .filter((n) => n.type === 'dns')
    .map((n) => n.value.toLowerCase())
}

/**
 * The organization in the subject, or ''.
 *
 * This is the field non-promise 2 turns on. A domain-validated certificate has
 * no organization, because no organization was validated -- the CA checked that
 * somebody could answer for the name and nothing else. `CN=github.com` with an
 * empty O is not an omission; it is the certificate accurately reporting the
 * absence of an identity claim.
 */
export function organization(cert: x509.X509Certificate): string {
  const o = new x509.Name(cert.subject).getField('O')
  return o.length > 0 ? (o[0] ?? '') : ''
}

/** The Common Name, which browsers no longer consult for name matching. */
export function commonName(cert: x509.X509Certificate): string {
  const cn = new x509.Name(cert.subject).getField('CN')
  return cn.length > 0 ? (cn[0] ?? '') : ''
}

/**
 * A human label for a certificate: its CN if it has one, else its whole
 * subject. Used in the chain diagram, where "CN=..., O=..., C=GB" does not fit
 * in a box and does not help a beginner.
 */
export function label(cert: x509.X509Certificate): string {
  return commonName(cert) || cert.subject
}

/** Is this certificate signed by its own subject? */
export function isSelfIssued(cert: x509.X509Certificate): boolean {
  return new x509.Name(cert.subject).toString() === new x509.Name(cert.issuer).toString()
}

/** Does this certificate's basicConstraints say it may sign other ones? */
export function isCa(cert: x509.X509Certificate): boolean {
  const bc = cert.getExtension(x509.BasicConstraintsExtension)
  return bc?.ca === true
}

/** The validity window against one instant. No call to Date.now(); see clock.ts. */
export function validityAt(cert: x509.X509Certificate, at: Date): Validity {
  const notBefore = cert.notBefore
  const notAfter = cert.notAfter
  const before = at.getTime() < notBefore.getTime()
  const after = at.getTime() > notAfter.getTime()
  return {
    notBefore,
    notAfter,
    at,
    inWindow: !before && !after,
    side: before ? 'before' : after ? 'after' : '',
  }
}

/**
 * The public key's algorithm, in words rather than an OID.
 *
 * Promise 1 is the one the lab does not have to argue for, and this is its
 * exhibit: a real key, of a real named type, that a real TLS handshake would
 * use. The curve name is as close to maths as this function gets, on purpose.
 */
export function keyDescription(cert: x509.X509Certificate): string {
  const alg = cert.publicKey.algorithm as EcKeyAlgorithm & RsaKeyAlgorithm
  if (alg.name === 'ECDSA' || alg.name === 'ECDH') {
    return `elliptic curve (${alg.namedCurve ?? 'unknown curve'})`
  }
  if (alg.name.startsWith('RSA')) {
    return `RSA (${alg.modulusLength ?? '?'}-bit)`
  }
  return alg.name
}

/** The signature algorithm that signed this certificate, in words. */
export function signatureDescription(cert: x509.X509Certificate): string {
  const alg = cert.signatureAlgorithm as EcdsaParams & { name: string; hash?: { name: string } }
  const hash = typeof alg.hash === 'object' ? alg.hash.name : String(alg.hash ?? '')
  return hash ? `${alg.name} with ${hash}` : alg.name
}

/** Lowercase hex, grouped in pairs -- the "show the bytes" disclosure. */
export function hex(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return [...u8].map((b) => b.toString(16).padStart(2, '0')).join(' ')
}

/** The SHA-256 fingerprint, which is how a certificate is named in the world. */
export async function fingerprint(cert: x509.X509Certificate): Promise<string> {
  const digest = await webCrypto.subtle.digest('SHA-256', cert.rawData)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
