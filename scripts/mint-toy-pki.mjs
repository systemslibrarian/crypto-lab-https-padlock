#!/usr/bin/env node
/*
 * Mints the lab's toy hierarchy into certs/ as PEM, ONCE, and the output is
 * committed.
 *
 *   node scripts/mint-toy-pki.mjs
 *
 * WHY THE OUTPUT IS PINNED RATHER THAN MINTED IN THE BROWSER
 *
 * crypto-lab-chain-of-trust mints its PKI per session, with fresh keys. That is
 * right for a lab whose subject is path building, and wrong here, for one
 * reason: this lab's tests are KATs. "The vendored chain parses to this subject,
 * this issuer, this validity window and these SANs" is only a known answer if
 * the bytes are known. Fresh keys per session would make every KAT a tautology
 * -- the test would re-derive whatever this run happened to generate and agree
 * with itself. So the toy certificates are minted here, written to certs/, and
 * committed; the browser parses the same bytes the tests assert.
 *
 * Everything minted is REAL. Real ECDSA P-256 key pairs from WebCrypto, real
 * DER TBS bytes, real signatures over them. The hierarchy is a toy in the sense
 * that its root is a trust anchor nobody's device carries -- not in the sense
 * that any of the cryptography is pretended. The lab verifies these signatures
 * in WebCrypto at runtime exactly as it verifies the real ones from github.com.
 *
 * VALIDITY WINDOWS ARE WIDE AND FIXED, 2026-01-01 to 2036-01-01, so a committed
 * fixture cannot rot into an expired one and make the lab teach a failure it did
 * not mean to teach. The lab validates against its own pinned instant anyway
 * (see src/pki/clock.ts), which is the real defence; this is the belt to that
 * brace.
 *
 * Re-running this rotates every key and signature. The KAT fields -- subjects,
 * issuers, validity, SANs -- are stable across a re-mint by construction, so the
 * KATs survive it; the fingerprints in certs/PROVENANCE.md do not. Re-mint only
 * deliberately, and update that file when you do.
 */

import { webcrypto } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const x509 = await import('@peculiar/x509')
x509.cryptoProvider.set(webcrypto)

const CERTS = fileURLToPath(new URL('../certs/', import.meta.url))
const EC_GEN = { name: 'ECDSA', namedCurve: 'P-256' }
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' }
const KU = x509.KeyUsageFlags
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1'

const NOT_BEFORE = new Date('2026-01-01T00:00:00Z')
const NOT_AFTER = new Date('2036-01-01T00:00:00Z')

const keys = () => webcrypto.subtle.generateKey(EC_GEN, true, ['sign', 'verify'])

async function mint({ subject, issuer, issuerKeys, subjectKeys, serial, san, ca, pathLen, eku }) {
  const extensions = [
    await x509.SubjectKeyIdentifierExtension.create(subjectKeys.publicKey, false, webcrypto),
    await x509.AuthorityKeyIdentifierExtension.create(issuerKeys.publicKey, false, webcrypto),
  ]
  if (ca) {
    extensions.push(new x509.BasicConstraintsExtension(true, pathLen, true))
    extensions.push(new x509.KeyUsagesExtension(KU.keyCertSign | KU.cRLSign, true))
  } else {
    extensions.push(new x509.BasicConstraintsExtension(false, undefined, true))
    extensions.push(new x509.KeyUsagesExtension(KU.digitalSignature, true))
  }
  if (eku) extensions.push(new x509.ExtendedKeyUsageExtension(eku, false))
  if (san) {
    extensions.push(
      new x509.SubjectAlternativeNameExtension(
        san.map((value) => ({ type: 'dns', value })),
        false,
      ),
    )
  }
  return x509.X509CertificateGenerator.create(
    {
      serialNumber: serial,
      subject,
      issuer,
      notBefore: NOT_BEFORE,
      notAfter: NOT_AFTER,
      signingAlgorithm: SIGN_ALG,
      publicKey: subjectKeys.publicKey,
      signingKey: issuerKeys.privateKey,
      extensions,
    },
    webcrypto,
  )
}

/* ── The toy hierarchy ─────────────────────────────────────────────────────
 *
 * Root -> DV CA -> leaf for a name the attacker controls.
 *
 * The names are the teaching. `login.yourbank-security.example` is a name
 * somebody could really register and really get a DV certificate for, under
 * .example, the RFC 2606 reserved TLD, so it can never belong to anyone. The
 * issuing CA is called "Toy DV CA" because DV is the whole point of
 * non-promise 2: what it attests is control of a name, and nothing else.
 */
const ROOT = 'CN=Padlock Lab Toy Root, O=HTTPS Padlock Lab'
const DV_CA = 'CN=Padlock Lab Toy DV CA, O=HTTPS Padlock Lab'
const ATTACKER_NAME = 'login.yourbank-security.example'
const SELFSIGNED_NAME = 'selfsigned.padlock.example'

const rootKeys = await keys()
const dvKeys = await keys()
const attackerKeys = await keys()
const selfSignedKeys = await keys()

const root = await mint({
  subject: ROOT, issuer: ROOT, issuerKeys: rootKeys, subjectKeys: rootKeys,
  serial: '01', ca: true,
})
const dv = await mint({
  subject: DV_CA, issuer: ROOT, issuerKeys: rootKeys, subjectKeys: dvKeys,
  serial: '02', ca: true, pathLen: 0, eku: [OID_SERVER_AUTH],
})
/* The attacker's leaf. Subject carries a CN and NO organization, which is what
 * a DV certificate looks like: there was no organization to validate. */
const attacker = await mint({
  subject: `CN=${ATTACKER_NAME}`, issuer: DV_CA, issuerKeys: dvKeys, subjectKeys: attackerKeys,
  serial: '03', san: [ATTACKER_NAME], eku: [OID_SERVER_AUTH],
})
/* A leaf that signs itself -- no issuer above it, so the walk has nowhere to
 * go. One of the five bad chains the path validator must reject. */
const selfSigned = await mint({
  subject: `CN=${SELFSIGNED_NAME}`, issuer: `CN=${SELFSIGNED_NAME}`,
  issuerKeys: selfSignedKeys, subjectKeys: selfSignedKeys,
  serial: '04', san: [SELFSIGNED_NAME], eku: [OID_SERVER_AUTH],
})

const files = {
  'toy-root.pem': root,
  'toy-dv-ca.pem': dv,
  'toy-attacker-leaf.pem': attacker,
  'toy-selfsigned-leaf.pem': selfSigned,
}
for (const [name, cert] of Object.entries(files)) {
  writeFileSync(CERTS + name, cert.toString('pem') + '\n')
  console.log(`${name.padEnd(28)} ${cert.subject}`)
}

/* Prove the links before writing anything is claimed about them: a mint that
 * silently produced an unverifiable signature would be discovered later, in a
 * browser, as a failing promise the lab blamed on its own validator. */
for (const [child, parent, label] of [
  [dv, root, 'toy DV CA signed by toy root'],
  [attacker, dv, 'attacker leaf signed by toy DV CA'],
  [root, root, 'toy root signed by itself'],
  [selfSigned, selfSigned, 'self-signed leaf signed by itself'],
]) {
  const ok = await child.verify({ publicKey: parent.publicKey }, webcrypto)
  console.log(`  ${ok ? 'verified' : 'FAILED  '}  ${label}`)
  if (!ok) process.exit(1)
}
