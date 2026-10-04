import type { Assessment } from '../pki/assess'
import { outcomeGlyph } from '../pki/assess'
import { human } from '../pki/clock'
import { commonName, dnsNames, hex, organization } from '../pki/parse'
import type { ClientHello } from '../tls/clienthello'
import * as copy from './content'
import { el, fill, list } from './dom'

/**
 * Render one Assessment.
 *
 * MARKERS. Every rendered verdict carries `data-verdict="<id>"` with a
 * `data-result`, and every rendered measurement carries `data-claim="<id>"`.
 * They are the contract e2e/verdict-mutations.json is written against: one
 * mutation per verdict, each required to turn a named test red. A marker the
 * page renders with no mutation covering it fails
 * e2e/verdict-coverage.spec.ts, and a mutation naming a marker the page never
 * renders fails it too.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. Every state renders an icon, a word and a
 * colour (WCAG 1.4.1). `outcomeGlyph` is the single source of the first two.
 */

function checkRow(
  check: Assessment['promises'][number],
  index: number,
): HTMLElement {
  const g = outcomeGlyph(check.outcome)
  const titleId = `check-${check.id}-title`
  return el('li', {
    class: 'check',
    'data-verdict': check.id,
    'data-result': check.outcome,
  }, [
    el('span', { class: 'check-icon', 'aria-hidden': 'true', text: g.icon }),
    el('div', { class: 'check-body' }, [
      el('div', { class: 'check-head' }, [
        el('h3', { class: 'check-title', id: titleId, text: `${index}. ${check.headline}` }),
        // The state in words, inside the row, so a screen reader hears it with
        // the title and a grayscale reader sees it.
        el('span', { class: 'check-state', text: g.word }),
      ]),
      el('p', { class: 'check-detail', text: check.detail }),
      list(
        { class: 'evidence', 'aria-label': `What the ${check.headline} check read` },
        check.evidence.map((e) =>
          el('li', { class: 'evidence-row' }, [
            el('span', { class: 'evidence-label', text: e.label }),
            el('span', { class: 'evidence-value', text: e.value }),
          ]),
        ),
      ),
    ]),
  ])
}

export function renderPadlock(host: Element, a: Assessment): void {
  const glyph = a.padlock.result === 'pass' ? '[LOCKED]' : a.padlock.result === 'alarm' ? '[LOCKED]' : '[BROKEN]'
  fill(
    host,
    el('h2', { id: 'padlock-h', text: copy.PADLOCK_HEADING }),
    el('div', {
      class: 'padlock',
      'data-verdict': 'padlock',
      'data-result': a.padlock.result,
      role: 'status',
      'aria-live': 'polite',
    }, [
      el('span', { class: 'padlock-glyph', 'aria-hidden': 'true', text: glyph }),
      el('div', { class: 'padlock-text' }, [
        el('p', { class: 'padlock-headline', text: a.padlock.headline }),
        el('p', { class: 'padlock-detail', text: a.padlock.detail }),
      ]),
    ]),
  )
}

export function renderPromises(host: Element, a: Assessment): void {
  fill(
    host,
    el('h2', { id: 'promises-h', text: copy.PROMISES_HEADING }),
    el('p', { class: 'lede', text: copy.PROMISES_LEDE }),
    list(
      { class: 'checks', 'aria-label': 'The four things the padlock proves' },
      a.promises.map((p, i) => checkRow(p, i + 1)),
    ),
  )
}

export function renderNonPromises(host: Element, a: Assessment): void {
  fill(
    host,
    el('h2', { id: 'nonpromises-h', text: copy.NONPROMISES_HEADING }),
    el('p', { class: 'lede', text: copy.NONPROMISES_LEDE }),
    list(
      { class: 'checks', 'aria-label': 'The four things the padlock does not prove' },
      a.nonPromises.map((p, i) => checkRow(p, i + 1)),
    ),
    // The negative claim (4.1d) is on screen in every state, not behind a
    // disclosure and not only in the README. It is tied to the operator check
    // above it, which is the fixture that makes it a result.
    el('div', { class: 'callout', 'data-tone': 'alarm', 'data-claim': 'negative-claim' }, [
      el('p', { class: 'callout-title', text: copy.NEGATIVE_CLAIM_TITLE }),
      el('p', { text: copy.NEGATIVE_CLAIM }),
    ]),
  )
}

export function renderChain(host: Element, a: Assessment): void {
  const nodes: HTMLElement[] = []
  a.path.steps.forEach((step, i) => {
    const role = step.role === 'leaf' ? 'THE SITE' : step.role === 'root' ? 'THE ROOT' : 'IN BETWEEN'
    const note = step.fromStore
      ? 'This one was NOT sent by the server. It came from the trusted list -- on a real device, the list your operating system or browser ships. Nothing in the chain vouches for it, and that is exactly where the trust actually comes from.'
      : step.role === 'leaf'
        ? 'The certificate the site presented for itself.'
        : 'Sent by the server to join the site up to a root.'
    nodes.push(
      el('li', { class: 'walk-step', 'data-from-store': String(step.fromStore) }, [
        el('span', { class: 'walk-role', text: role }),
        el('div', {}, [
          el('span', { class: 'walk-name', text: step.name }),
          el('p', { class: 'walk-note', text: note }),
          step.inDate
            ? el('p', { class: 'walk-note', text: `In date on ${human(a.at)}.` })
            : el('p', { class: 'walk-note', text: `NOT in date on ${human(a.at)}.` }),
        ]),
      ]),
    )
    const link = a.path.links[i]
    if (link) {
      const g = link.verified ? '[OK]' : '[X]'
      nodes.push(
        el('li', {
          class: 'walk-link',
          'data-verdict': `link-${i}`,
          'data-result': link.verified ? 'pass' : 'fail',
        }, [
          el('span', { class: 'walk-link-arrow', 'aria-hidden': 'true', text: '|' }),
          el('span', { text: `${g} signed by the one below` }),
          link.verified
            ? el('span', { class: 'walk-link-reason', text: `${link.issuerName}'s signature over ${link.childName} checks out.` })
            : el('span', { class: 'walk-link-reason', text: link.reason }),
        ]),
      )
    }
  })

  fill(
    host,
    el('h2', { id: 'chain-h', text: copy.CHAIN_HEADING }),
    el('p', { class: 'lede', text: copy.CHAIN_LEDE }),
    list({ class: 'walk', 'aria-label': 'The certificate chain, from the site down to a root' }, nodes),
    el('p', {
      class: 'hint',
      'data-claim': 'chain-length',
      text: `${a.path.steps.length} certificates in the walk, ${a.path.links.length} signatures checked.`,
    }),
    el('div', { class: 'callout', 'data-tone': 'info', 'data-claim': 'anchor-source' }, [
      el('p', { class: 'callout-title', text: 'WHY YOU BELIEVE THE ROOT' }),
      el('p', {
        text: a.path.reachedAnchor
          ? a.path.anchorWhy
          : 'The walk never reached a root in the trusted list, so there is nothing here to believe.',
      }),
    ]),
    detailsBytes('Show the certificate fields', fieldTable(a)),
  )
}

function fieldTable(a: Assessment): HTMLElement {
  const leaf = a.leaf
  const rows: [string, string][] = [
    ['Name on the certificate', commonName(leaf) || '(none)'],
    ['Organization', organization(leaf) || '(none -- nobody validated one)'],
    ['Names it is valid for', dnsNames(leaf).join(', ') || '(none)'],
    ['Issued by', leaf.issuer],
    ['Valid from', human(leaf.notBefore)],
    ['Valid until', human(leaf.notAfter)],
    ['Serial number', leaf.serialNumber],
  ]
  return list(
    { class: 'evidence', 'aria-label': 'Certificate fields' },
    rows.map(([label, value]) =>
      el('li', { class: 'evidence-row' }, [
        el('span', { class: 'evidence-label', text: label }),
        el('span', { class: 'evidence-value', text: value }),
      ]),
    ),
  )
}

/**
 * A "show the bytes" disclosure. Progressive disclosure, master template 0.3:
 * the explanation is simplified and the cryptography is not, so the real DER is
 * one click away for anyone who wants it and never on screen for anyone who
 * does not.
 */
function detailsBytes(summaryText: string, body: HTMLElement): HTMLElement {
  return el('details', {}, [
    el('summary', { text: summaryText }),
    el('div', { class: 'details-body' }, [body]),
  ])
}

export function renderWire(host: Element, hello: ClientHello): void {
  const sni = hello.spans.find((s) => s.label === 'server name')!
  const suites = hello.spans.find((s) => s.label === 'cipher suites')!
  const bytes = hello.bytes

  // Three runs: before the name, the name itself, after. The name is marked by
  // colour AND weight AND an underline AND the legend below, never by colour
  // alone.
  const before = hex(bytes.slice(0, sni.start))
  const name = hex(bytes.slice(sni.start, sni.start + sni.length))
  const after = hex(bytes.slice(sni.start + sni.length))

  const hexView = el('div', {
    class: 'bytes',
    role: 'region',
    tabindex: '0',
    'aria-label': 'The first message your browser sends, as hexadecimal bytes, with the site name highlighted',
  }, [
    document.createTextNode(`${before} `),
    el('span', { class: 'bytes-hl', text: name }),
    document.createTextNode(` ${after}`),
  ])

  const asciiName = hello.hostnameInBytes

  fill(
    host,
    el('h2', { id: 'wire-h', text: copy.WIRE_HEADING }),
    el('p', { class: 'lede', text: copy.WIRE_LEDE }),
    hexView,
    el('p', { class: 'bytes-legend' }, [
      el('span', {}, [el('span', { class: 'bytes-hl', text: 'highlighted' }), document.createTextNode(' = the site name, in plain text')]),
    ]),
    el('p', {
      'data-claim': 'sni-readable',
      text: `Read back out of those bytes as text, that is: ${asciiName}`,
    }),
    el('p', {
      class: 'hint',
      'data-claim': 'sni-offset',
      text: `The name starts at byte ${sni.start} of ${bytes.length}, and the list of encryption methods at byte ${suites.start}. Neither is encrypted and neither is signed.`,
    }),
    detailsBytes(
      'Show what each part of the message is',
      list(
        { class: 'evidence', 'aria-label': 'Parts of the first message' },
        hello.spans.map((s) =>
          el('li', { class: 'evidence-row' }, [
            el('span', { class: 'evidence-label', text: `${s.label} (byte ${s.start})` }),
            el('span', { class: 'evidence-value', text: s.note }),
          ]),
        ),
      ),
    ),
    el('div', { class: 'callout', 'data-tone': 'alarm' }, [
      el('p', { class: 'callout-title', text: 'WHAT THIS MEANS FOR YOU' }),
      el('p', {
        text:
          `Anyone who can watch your traffic -- your network, your employer, your internet provider -- can read "${asciiName}" ` +
          'out of this message. They cannot read what you do on the site. They can read that you went there.',
      }),
    ]),
    el('p', {
      class: 'hint',
      text:
        `This lab encodes the message and never sends it. The name in it is the host from the address you set above. ` +
        (hello.keyShareIsReal
          ? 'The key share is a real X25519 public key generated here; its private half was discarded without being used.'
          : 'This browser has no X25519, so the key share is random bytes rather than a real public key -- said plainly rather than claimed either way.'),
    }),
    el('p', { class: 'hint', text: `Encryption methods offered, in the clear: ${hello.cipherSuiteNames.join(', ')}.` }),
  )
}
