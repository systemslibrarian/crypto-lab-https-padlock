/**
 * Every sentence of product copy on this page, in one place.
 *
 * Copy lives here rather than inline for the reason master template 4.1a gives:
 * a sentence is a claim, claims belong to e2e/claims.spec.ts, and a test that
 * owns a sentence needs one place to find it. The gate's boot() asserts
 * STRUCTURE and never reads anything in this file.
 *
 * The register is fixed by the brief: this is a Beginner lab, so plain language
 * comes before any hex and no reader is ever asked to follow a derivation.
 * Nothing here contains a formula, a curve, or a modulus.
 */

export const INTRO_HEADING = 'What the padlock actually says'

export const INTRO = [
  'When your browser shows a padlock, it has checked a small, specific list of things -- and that list is shorter than almost everyone assumes.',
  'The padlock is a statement about the connection and the name. It says your traffic is scrambled on the way, and that the name in the address bar is the name on the certificate the site presented. That is genuinely valuable and it is genuinely narrow.',
  'It says nothing at all about the people behind the name. This page takes a real certificate apart, shows you the four things the padlock proves, lets you break each one, and then shows you a flawless certificate for a site you would never want to visit.',
]

export const CONTROLS_HEADING = 'Pick a site, and set the date'

export const CONTROLS_LEDE =
  'Every certificate below is real. One was captured from the public internet; the other two this lab minted for itself, with real keys and real signatures.'

export const ADDRESS_LABEL = 'The address you think you are visiting'

export const ADDRESS_HINT =
  'Change this to something the certificate is not for, and watch the name check fail the way a browser would.'

export const DATE_LABEL = 'The date you are checking'

export const DATE_HINT =
  'This lab has its own clock, so the lesson never rots. Move it past the expiry date and watch a valid certificate become invalid with no cryptography changing.'

export const PADLOCK_HEADING = 'The padlock'

export const CHAIN_HEADING = 'Who vouched for this, and why you believe them'

export const CHAIN_LEDE =
  'Each certificate was signed by the one below it. Follow it down far enough and you arrive at a certificate nobody signed for you -- it was already on your device.'

export const PROMISES_HEADING = 'The four things the padlock proves'

export const PROMISES_LEDE =
  'Each of these is checked against the real certificate bytes. Break any of them with the controls above.'

export const NONPROMISES_HEADING = 'The four things it does not'

export const NONPROMISES_LEDE =
  'These are not warnings about something going wrong. They are things the padlock was never built to tell you, each shown here rather than asserted.'

export const WIRE_HEADING = 'The first message your browser sends'

export const WIRE_LEDE =
  'Before any encryption exists, your browser has to tell the server which site it wants, so the server knows which certificate to send. Here is that message, byte for byte, with the name highlighted.'

export const SCOPE_HEADING = 'What is real here, and what is not'

export const SCOPE_REAL = [
  'The certificates are real. The one for github.com was captured from the public internet on 4 October 2026; the two trust anchors came out of a real operating system trust store.',
  'Every signature check runs in your browser through WebCrypto, over the real certificate bytes. Flip one bit and it fails, because it is actually being checked.',
  'The first-message bytes are a real TLS 1.3 ClientHello, encoded to RFC 8446 and RFC 6066.',
]

export const SCOPE_NOT = [
  'This lab makes no network connection and runs no handshake. It reads certificates that were already captured; it does not watch TLS happen.',
  'Its path checking is a teaching subset of RFC 5280. It does not check revocation, name constraints, policy constraints, or path length -- so a chain this page accepts is not thereby a chain a browser would accept. Chain of Trust is the lab for that.',
  'The random bytes in the first message are real randomness, but no handshake follows them, so no key is actually exchanged.',
  'This is a teaching demo, not production code.',
]

/** The negative claim, 4.1d. One sentence, scoped to the construction here. */
export const NEGATIVE_CLAIM =
  'A valid certificate does not establish who operates the name it was issued for.'

export const NEGATIVE_CLAIM_TITLE = 'WHAT THIS DOES NOT BUY YOU'

export const NEXT_HEADING = 'Where to go next'

export const NEXT: readonly { label: string; href: string; why: string }[] = [
  {
    label: 'Chain of Trust',
    href: 'https://systemslibrarian.github.io/crypto-lab-chain-of-trust/',
    why: 'Path building against real RFC 5280 path validation -- name constraints, path length, cross-signing, and the traps this lab deliberately leaves out.',
  },
  {
    label: 'TLS Handshake',
    href: 'https://systemslibrarian.github.io/crypto-lab-tls-handshake/',
    why: 'The handshake itself: how the encryption this page takes for granted actually gets set up.',
  },
  {
    label: 'Blind Hello',
    href: 'https://systemslibrarian.github.io/crypto-lab-blind-hello/',
    why: 'The fix for the hostname sitting in the clear -- encrypted ClientHello, and what it does and does not hide.',
  },
  {
    label: 'Downgrade Wire',
    href: 'https://systemslibrarian.github.io/crypto-lab-downgrade-wire/',
    why: 'What happens when someone strips that unauthenticated negotiation down to something weaker.',
  },
  {
    label: 'DNSSEC Chain',
    href: 'https://systemslibrarian.github.io/crypto-lab-dnssec-chain/',
    why: 'A separate chain of trust that answers a different question: not "is this the right certificate" but "is this the right address".',
  },
]
