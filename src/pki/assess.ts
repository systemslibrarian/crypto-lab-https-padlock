import type * as x509 from '@peculiar/x509'
import { human } from './clock'
import { LAB_TRUST_STORE, type Scenario } from './fixtures'
import { matchName } from './hostname'
import {
  commonName, dnsNames, keyDescription, organization, parsePem, signatureDescription,
  validityAt, webCrypto,
} from './parse'
import { validatePath, type PathResult } from './path'
import type { CheckResult, Outcome } from './types'

/**
 * Everything the page renders, computed from the certificate bytes.
 *
 * The page's job is to display this object. It does no arithmetic of its own
 * and reaches no conclusion of its own, which is what lets the claims suite
 * assert outcomes rather than sentences: every verdict on screen traces to a
 * field here, and every field here traces to a parse or a WebCrypto verify.
 */
export interface Assessment {
  readonly scenario: Scenario
  readonly address: string
  readonly at: Date
  readonly leaf: x509.X509Certificate
  readonly path: PathResult
  /** The four things the padlock proves, in the order the page shows them. */
  readonly promises: readonly CheckResult[]
  /** The four it does not. */
  readonly nonPromises: readonly CheckResult[]
  /** The padlock itself: pass, fail, or the alarm case. */
  readonly padlock: {
    readonly result: 'pass' | 'fail' | 'alarm'
    readonly headline: string
    readonly detail: string
  }
}

export interface AssessInput {
  readonly scenario: Scenario
  /** The address the reader typed. Defaults to the scenario's own. */
  readonly address: string
  readonly at: Date
  /** When true, one bit of the leaf's signature is flipped first. */
  readonly tamperedLeaf?: x509.X509Certificate | undefined
}

/**
 * Promise 1 -- there is a usable key, and what it is actually FOR.
 *
 * The one promise this lab does not have to argue for, and the one it must be
 * most careful about, in two ways.
 *
 * First, this lab runs no handshake (a stated non-goal), so it cannot and does
 * not claim to have observed encryption. Reporting a green "encrypted: yes"
 * would be the lab asserting something it never measured.
 *
 * Second -- and this was wrong here until it was corrected -- the certificate's
 * public key is NOT the key your traffic is encrypted to. That was RSA key
 * transport, and TLS 1.3 removed it. In TLS 1.3 the certificate's key does one
 * job: the server signs part of the handshake with the private half
 * (CertificateVerify, RFC 8446 section 4.4.3) and the client checks that
 * signature with this public half. The encryption keys come from a separate
 * ephemeral (EC)DHE exchange that this certificate has no part in. Calling this
 * "a key to encrypt to" taught a beginner something false about the protocol
 * while every test stayed green, which is exactly the kind of claim 4.1b
 * exists to catch.
 */
async function checkKey(leaf: x509.X509Certificate): Promise<CheckResult> {
  // IMPORTED, not merely parsed. An earlier version of this function returned
  // 'pass' unconditionally with the key's algorithm beside it, which made
  // promise 1 the one asserted verdict on a page whose whole argument is that
  // it asserts nothing -- and gave the check no reachable failure branch at
  // all. Handing the key to WebCrypto is what turns "there is a key to encrypt
  // to" into something this lab actually found out.
  let imported = false
  try {
    const key = await leaf.publicKey.export(webCrypto)
    imported = key.type === 'public'
  } catch {
    // A key WebCrypto will not import -- an unsupported curve, a malformed
    // SubjectPublicKeyInfo -- is a key no browser can start a handshake with.
    imported = false
  }
  return {
    id: 'promise-key',
    outcome: imported ? 'pass' : 'fail',
    headline: imported ? 'The certificate carries a usable key' : 'The key cannot be used',
    detail: imported
      ? 'Your browser loaded the certificate\'s public key and it works. This key is how the site proves it really holds the matching private key: ' +
        'during the handshake the server signs a piece of the conversation, and your browser checks that signature with this key. ' +
        'It is NOT the key your traffic is encrypted with -- that one is agreed separately and freshly for each connection. ' +
        'Neither step happens in this lab; see TLS Handshake for both.'
      : 'This certificate carries a public key your browser cannot load, so the site could not prove it holds the matching private key -- whatever else about the certificate is in order.',
    evidence: [
      { label: 'Key type', value: keyDescription(leaf) },
      { label: 'Loaded by your browser', value: imported ? 'yes' : 'no' },
      { label: 'What this key is for', value: 'checking the server\'s handshake signature' },
      { label: 'Encrypts your traffic', value: 'no -- a separate key is agreed per connection' },
      { label: 'This certificate signed with', value: signatureDescription(leaf) },
    ],
  }
}

/** Promise 2 -- the name matches. RFC 6125, computed in hostname.ts. */
function checkName(leaf: x509.X509Certificate, address: string): CheckResult {
  const presented = dnsNames(leaf)
  const m = matchName(address, presented)
  return {
    id: 'promise-name',
    outcome: m.matched ? 'pass' : 'fail',
    headline: m.matched ? 'The name matches' : 'The name does not match',
    detail: m.matched
      ? m.wildcard
        ? `The address you asked for is covered by "${m.via}", a wildcard that stands for exactly one label.`
        : `The certificate lists "${m.via}", which is exactly the address you asked for.`
      : presented.length === 0
        ? 'This certificate lists no names at all, so it cannot match any address.'
        : `You asked for "${m.address}", and this certificate is only for ${presented.map((n) => `"${n}"`).join(' and ')}. A browser would refuse to go on.`,
    evidence: [
      { label: 'You asked for', value: m.address || '(nothing)' },
      { label: 'Certificate is for', value: presented.length > 0 ? presented.join(', ') : '(no names)' },
      { label: 'Matched', value: m.matched ? m.via : 'nothing' },
    ],
  }
}

/** Promise 3 -- somebody vouched. The walk, in path.ts. */
function checkVouched(path: PathResult): CheckResult {
  const root = path.steps.find((s) => s.role === 'root')
  const links = path.links.length
  const verified = path.links.filter((l) => l.verified).length
  const ok = path.reachedAnchor && path.links.every((l) => l.verified)
  return {
    id: 'promise-vouched',
    outcome: ok ? 'pass' : 'fail',
    headline: ok ? 'Somebody vouched for it' : 'Nobody in the trusted list vouched for it',
    detail: ok
      ? `Each certificate was signed by the next one up, and the chain ends at "${root?.name ?? 'a root'}" -- a root the server never sent, taken from the trusted list instead. ${path.anchorWhy}`
      : path.reason,
    evidence: [
      { label: 'Signatures checked', value: `${verified} of ${links}` },
      { label: 'Ends at', value: root?.name ?? 'nothing in the trusted list' },
      { label: 'Root came from', value: root?.fromStore ? "this lab's trusted list" : 'the server' },
    ],
  }
}

/** Promise 4 -- it has not expired. The clock, not Date.now(). */
function checkTime(leaf: x509.X509Certificate, at: Date): CheckResult {
  const v = validityAt(leaf, at)
  return {
    id: 'promise-time',
    outcome: v.inWindow ? 'pass' : 'fail',
    headline: v.inWindow ? 'It has not expired' : v.side === 'after' ? 'It has expired' : 'It is not valid yet',
    detail: v.inWindow
      ? `The date you are checking falls inside the window the certificate was issued for. Move the date past ${human(v.notAfter)} and this becomes a failure, with no cryptography changing at all.`
      : v.side === 'after'
        ? `This certificate stopped being valid on ${human(v.notAfter)}. Every signature in the chain still checks out -- the only thing that changed is the date.`
        : `This certificate does not become valid until ${human(v.notBefore)}.`,
    evidence: [
      { label: 'Valid from', value: human(v.notBefore) },
      { label: 'Valid until', value: human(v.notAfter) },
      { label: 'Checking', value: human(at) },
    ],
  }
}

/**
 * Non-promise 1 -- not that the site is honest.
 *
 * This is the lab's sharpest exhibit and the one whose colour must never be
 * green. When every check passes on a certificate for a name the reader did not
 * mean to visit, the correct rendering is ALARM: the result is right and the
 * reader is about to misunderstand it.
 */
function checkHonest(scenario: Scenario, everythingPassed: boolean): CheckResult {
  return {
    id: 'nonpromise-honest',
    outcome: 'not-established',
    headline: 'Not that the site is honest',
    detail: everythingPassed
      ? `Every check above passed for "${scenario.site}". Nothing in any certificate anywhere says whether the people running a name mean you well. A certificate is about a name, and that is all it is about.`
      : 'A certificate says nothing about the intentions of whoever runs the name. That is true whether the checks pass or fail.',
    evidence: [
      { label: 'All checks passed', value: everythingPassed ? 'yes' : 'no' },
      { label: 'Honesty established', value: 'no -- there is no field for it' },
    ],
  }
}

/**
 * Non-promise 2 -- not that the company is who it says.
 *
 * THE LAB'S NEGATIVE CLAIM (master template 4.1d). The claim is scoped to the
 * construction on the page: a domain-validated certificate does not establish
 * who operates the name. It is expressed as this lab's own check returning
 * "not established", and its evidence is the organization field -- read out of
 * the certificate, empty, because nobody validated one.
 *
 * It is "not established" rather than "fails" on purpose. There is no failure
 * code in X.509 for "the operator was not identified", and inventing one would
 * teach the opposite of the lesson: the absence of the check IS the exhibit.
 */
function checkOperator(leaf: x509.X509Certificate): CheckResult {
  const org = organization(leaf)
  const cn = commonName(leaf)
  return {
    id: 'nonpromise-operator',
    // Always "not established", whether or not an organization is named: an
    // O= field is a claim the issuer may or may not have checked, and this lab
    // checks neither. The branch below is about the EXPLANATION, not the
    // outcome -- the outcome is the negative claim and it does not vary.
    outcome: 'not-established',
    headline: 'Not that the company is who it says',
    detail:
      org === ''
        ? `This certificate carries no organization name at all. The only thing its issuer checked was that somebody could answer for "${cn}" -- that is what domain validation means, and it is what almost every certificate on the web is. Who actually operates the name is NOT ESTABLISHED.`
        : `This certificate names the organization "${org}", but this lab does not verify that claim and neither does the padlock on its own. Who actually operates the name is NOT ESTABLISHED by anything shown here.`,
    evidence: [
      { label: 'Organization in certificate', value: org === '' ? '(none -- nobody validated one)' : org },
      { label: 'Issuer checked', value: 'control of the name, and nothing else' },
      { label: 'Operator identity', value: 'not established' },
    ],
  }
}

/** Non-promise 3 -- not that the hostname was private. RFC 6066; see tls/. */
function checkSni(address: string, hostnameInBytes: string, offset: number): CheckResult {
  return {
    id: 'nonpromise-sni',
    outcome: 'not-established',
    headline: 'Not that the hostname was private',
    detail:
      `Before any encryption exists, your browser sends the name of the site in the clear so the server knows which certificate to offer. ` +
      `It is readable at byte ${offset} of the first message below, so anyone on the network path can see which site you asked for in this example. ` +
      `A newer extension called Encrypted ClientHello hides it, and this message does not use one. What the network still cannot read is the contents of your traffic -- though the site you are talking to obviously can.`,
    evidence: [
      { label: 'Name sent in the clear', value: hostnameInBytes },
      { label: 'Matches the address', value: hostnameInBytes === address ? 'yes' : 'no' },
      { label: 'Encrypted ClientHello used', value: 'no -- which is why it is readable here' },
      { label: 'Hostname privacy', value: 'not provided in this example' },
    ],
  }
}

/** Non-promise 4 -- not that the strongest cryptography was used. */
function checkStrength(suites: readonly string[]): CheckResult {
  return {
    id: 'nonpromise-strength',
    outcome: 'not-established',
    headline: 'Not that the strongest cryptography was used',
    detail:
      'Your browser and the server agree on which encryption to use at the very start, in the same unprotected message as the hostname, before either side has proved who it is. ' +
      'TLS 1.3 does check afterwards that nobody altered that conversation -- the handshake signs its own transcript -- so this is not a free downgrade, and that is worth being clear about. ' +
      'What a padlock still does not tell you is which of these was actually chosen, or whether it was the strongest one both sides could have managed.',
    evidence: [
      { label: 'Offered in the clear', value: `${suites.length} cipher suites` },
      { label: 'Authenticated at this moment', value: 'no -- nobody has authenticated yet' },
      { label: 'Checked later in the handshake', value: 'yes -- TLS 1.3 signs the transcript' },
      { label: 'Which one was chosen', value: 'not shown by a padlock' },
    ],
  }
}

/** The headline the padlock itself shows. */
function padlockVerdict(
  promises: readonly CheckResult[],
  scenario: Scenario,
): Assessment['padlock'] {
  const failed = promises.filter((p) => p.outcome === 'fail')
  if (failed.length > 0) {
    return {
      result: 'fail',
      headline: 'NO PADLOCK',
      detail: `Your browser would refuse this connection, or warn you hard. ${failed[0]!.headline}.`,
    }
  }
  // Every check passed. For the attacker exhibit that is precisely the moment
  // to raise an alarm rather than show a success -- a correct result the reader
  // is about to misread.
  if (!scenario.real) {
    return {
      result: 'alarm',
      headline: 'PADLOCK SHOWN — AND NOT WHO YOU THINK',
      detail: `Every check passed. Your browser would show a padlock for "${scenario.site}" and mean every word of it. It still is not your bank.`,
    }
  }
  return {
    result: 'pass',
    headline: 'PADLOCK SHOWN',
    detail: `All four checks passed for "${scenario.site}". That is what the padlock means, and the four things below are what it still does not.`,
  }
}

export interface WireFacts {
  readonly hostnameInBytes: string
  readonly sniOffset: number
  readonly cipherSuiteNames: readonly string[]
}

export async function assess(input: AssessInput, wire: WireFacts): Promise<Assessment> {
  const { scenario, address, at } = input
  const chain = scenario.chain.map(parsePem)
  const leaf = input.tamperedLeaf ?? chain[0]!
  const effectiveChain = [leaf, ...chain.slice(1)]

  const path = await validatePath(effectiveChain, LAB_TRUST_STORE, at)

  const key = await checkKey(leaf)
  const name = checkName(leaf, address)
  const vouched = checkVouched(path)
  const time = checkTime(leaf, at)
  const promises = [key, name, vouched, time]
  const everyPromisePassed = promises.every((p) => p.outcome === 'pass')

  const nonPromises = [
    // ONE value, derived from the actual promise results, used everywhere.
    // This used to be `pathOk && nameOk`, which ignored expiry and the key --
    // so an expired certificate rendered "NO PADLOCK" at the top of the page
    // and "Every check above passed" a few hundred pixels below it. A page that
    // contradicts itself teaches whichever half the reader happened to read.
    checkHonest(scenario, everyPromisePassed),
    checkOperator(leaf),
    checkSni(address, wire.hostnameInBytes, wire.sniOffset),
    checkStrength(wire.cipherSuiteNames),
  ]

  return {
    scenario, address, at, leaf, path, promises, nonPromises,
    padlock: padlockVerdict(promises, scenario),
  }
}

/** Icon + word for an outcome. Never colour alone (WCAG 1.4.1). */
export function outcomeGlyph(outcome: Outcome): { icon: string; word: string } {
  switch (outcome) {
    case 'pass': return { icon: '[OK]', word: 'PASSES' }
    case 'fail': return { icon: '[X]', word: 'FAILS' }
    case 'not-established': return { icon: '[!]', word: 'NOT ESTABLISHED' }
    case 'out-of-scope': return { icon: '[-]', word: 'OUT OF SCOPE' }
  }
}
