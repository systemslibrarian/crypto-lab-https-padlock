import type * as x509 from '@peculiar/x509'
import { isCa, isSelfIssued, label, parsePem, validityAt, webCrypto } from './parse'
import type { Link, Role } from './types'

/**
 * Walk a chain to a trust anchor, and verify every signature on the way.
 *
 * This is a teaching subset of RFC 5280 path validation, and the subset is
 * stated rather than implied. It checks, per link:
 *
 *   - the child's issuer name equals the parent's subject name;
 *   - the parent's signature over the child's DER verifies, in WebCrypto;
 *   - the parent is allowed to sign certificates (basicConstraints CA:TRUE);
 *   - every certificate in the path is inside its validity window.
 *
 * And it requires the path to END at a certificate the device's store holds.
 *
 * What it does NOT do, each of which is a non-goal in brief.md: revocation
 * (OCSP or CRL), name constraints, policy constraints, path-length constraints,
 * or extended key usage chaining. `crypto-lab-chain-of-trust` is the lab for
 * path building against those; this one exists to answer what the padlock
 * means, and a beginner reaching for that answer does not need pathLen.
 *
 * The honest consequence is stated on the page: a chain this validator accepts
 * is not thereby a chain a browser would accept.
 */

export interface AnchorStore {
  /** The anchors, keyed by subject name, as a device store is. */
  readonly anchors: readonly { subject: string; cert: x509.X509Certificate; why: string }[]
  find(subject: string): { subject: string; cert: x509.X509Certificate; why: string } | undefined
}

export function makeStore(
  entries: readonly { pem: string; why: string }[],
): AnchorStore {
  const anchors = entries.map(({ pem, why }) => {
    const cert = parsePem(pem)
    return { subject: cert.subject, cert, why }
  })
  const bySubject = new Map(anchors.map((a) => [a.subject, a]))
  return {
    anchors,
    find: (subject) => bySubject.get(subject),
  }
}

export interface PathStep {
  readonly index: number
  readonly role: Role
  readonly name: string
  readonly cert: x509.X509Certificate
  /** True when this step is the device's own copy rather than one the server sent. */
  readonly fromStore: boolean
  readonly inDate: boolean
}

export interface PathResult {
  readonly steps: readonly PathStep[]
  readonly links: readonly Link[]
  /** Every signature verified, every certificate in date, and it reached an anchor. */
  readonly trusted: boolean
  /** The first thing that went wrong, in plain language. '' when nothing did. */
  readonly reason: string
  readonly reachedAnchor: boolean
  /** Why the anchor is trusted, quoted from the store. '' when none was reached. */
  readonly anchorWhy: string
}

/**
 * Verify that `parent` signed `child`.
 *
 * `@peculiar/x509` hands the TBS bytes and the signature to WebCrypto with the
 * parent's public key. For the ECDSA certificates this lab ships that includes
 * unwrapping the DER SEQUENCE of r and s into the raw r||s pair WebCrypto
 * expects -- a real step that a hand-rolled verifier gets wrong, which is why
 * it is a named library rather than hand-rolled here. The signature itself is
 * genuinely checked; a one-byte change anywhere in the child's TBS makes this
 * return false, and the lab has a control that does exactly that.
 */
async function signedBy(
  child: x509.X509Certificate,
  parent: x509.X509Certificate,
): Promise<boolean> {
  try {
    return await child.verify({ publicKey: parent.publicKey }, webCrypto)
  } catch {
    // A malformed signature, an unsupported curve, a key that cannot be
    // imported: all of them mean "this did not verify". Fail closed.
    return false
  }
}

/**
 * Walk `chain` -- as the server sent it, leaf first -- to an anchor in `store`.
 *
 * The walk is deliberately literal: it follows the chain in the order it was
 * given rather than building every candidate path. A server that sends its
 * certificates out of order, or omits one, FAILS here, which is what makes
 * "missing intermediate" a demonstrable failure rather than something the
 * validator quietly repairs. Real browsers do repair some of it, and the page
 * says so.
 */
export async function validatePath(
  chain: readonly x509.X509Certificate[],
  store: AnchorStore,
  at: Date,
): Promise<PathResult> {
  if (chain.length === 0) {
    return { steps: [], links: [], trusted: false, reason: 'There is no certificate to check.', reachedAnchor: false, anchorWhy: '' }
  }

  const steps: PathStep[] = []
  const links: Link[] = []
  let reason = ''

  // Every certificate the server sent becomes a step. Roles are assigned by
  // position and shape, which is how a reader sees them.
  chain.forEach((cert, index) => {
    const role: Role = index === 0 ? 'leaf' : 'intermediate'
    steps.push({
      index,
      role,
      name: label(cert),
      cert,
      fromStore: false,
      inDate: validityAt(cert, at).inWindow,
    })
  })

  // Walk the served chain, link by link.
  for (let i = 0; i < chain.length - 1; i += 1) {
    const child = chain[i]!
    const parent = chain[i + 1]!
    const link = await judgeLink(child, parent, i, at)
    links.push(link)
    if (!link.verified && !reason) reason = link.reason
  }

  // The top of what the server sent. Where does it go?
  const top = chain[chain.length - 1]!
  const anchor = store.find(top.issuer)

  let reachedAnchor = false
  let anchorWhy = ''

  if (anchor) {
    // The device has the issuer of the top served certificate. One more link.
    const link = await judgeLink(top, anchor.cert, chain.length - 1, at)
    links.push(link)
    if (!link.verified && !reason) reason = link.reason
    steps.push({
      index: chain.length,
      role: 'root',
      name: label(anchor.cert),
      cert: anchor.cert,
      fromStore: true,
      inDate: validityAt(anchor.cert, at).inWindow,
    })
    reachedAnchor = link.verified
    anchorWhy = anchor.why
  } else if (store.find(top.subject)) {
    // The device has this very certificate. The walk is already home: the
    // served copy is redundant, which is the ordinary case for a chain that
    // ends in a cross-signed root.
    const held = store.find(top.subject)!
    steps[steps.length - 1] = { ...steps[steps.length - 1]!, role: 'root', fromStore: true }
    reachedAnchor = true
    anchorWhy = held.why
  } else if (isSelfIssued(top)) {
    reason = reason || `${label(top)} signed itself, and your device does not have it. Anyone can sign their own certificate, so a signature from the same name it is claiming proves nothing.`
  } else {
    reason = reason || `The chain stops at ${label(top)}, which was signed by ${label2(top)} -- and that certificate is neither in the chain nor on your device. The walk has nowhere left to go.`
  }

  const allInDate = steps.every((s) => s.inDate)
  if (!allInDate && !reason) {
    const bad = steps.find((s) => !s.inDate)!
    const v = validityAt(bad.cert, at)
    reason = v.side === 'after'
      ? `${bad.name} expired on ${v.notAfter.toISOString().slice(0, 10)}, which is before the date you are checking.`
      : `${bad.name} is not valid until ${v.notBefore.toISOString().slice(0, 10)}, which is after the date you are checking.`
  }

  const everyLinkVerified = links.length > 0 && links.every((l) => l.verified)
  const trusted = everyLinkVerified && reachedAnchor && allInDate

  return { steps, links, trusted, reason: trusted ? '' : reason, reachedAnchor, anchorWhy }
}

/** The issuer's CN, for a sentence. */
function label2(cert: x509.X509Certificate): string {
  const m = /CN=([^,]+)/.exec(cert.issuer)
  return m?.[1] ?? cert.issuer
}

/**
 * One link, judged. The order of these tests is the order a reader should think
 * in: do the names line up, is the parent even allowed to do this, and only
 * then does the signature mean anything.
 */
async function judgeLink(
  child: x509.X509Certificate,
  parent: x509.X509Certificate,
  childIndex: number,
  at: Date,
): Promise<Link> {
  const childName = label(child)
  const issuerName = label(parent)

  if (child.issuer !== parent.subject) {
    return {
      childIndex, childName, issuerName, verified: false,
      reason: `${childName} says it was signed by "${child.issuer}", but the next certificate in the chain belongs to "${parent.subject}". Those are different names, so this is not the right certificate to check against.`,
    }
  }

  if (!isCa(parent)) {
    return {
      childIndex, childName, issuerName, verified: false,
      reason: `${issuerName} is not allowed to sign certificates for other names -- it is marked as an ordinary end certificate, not a certificate authority. Its signature can be mathematically perfect and still carry no authority.`,
    }
  }

  if (!validityAt(parent, at).inWindow) {
    return {
      childIndex, childName, issuerName, verified: false,
      reason: `${issuerName} was not valid on the date you are checking, so nothing it signed can be relied on for that date.`,
    }
  }

  const ok = await signedBy(child, parent)
  return {
    childIndex, childName, issuerName, verified: ok,
    reason: ok
      ? ''
      : `${issuerName}'s signature over ${childName} does not check out. The bytes have been changed since it was signed, or it was never signed by this certificate at all.`,
  }
}
