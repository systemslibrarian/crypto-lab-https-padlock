import type { Assessment } from '../pki/assess'
import { outcomeGlyph } from '../pki/assess'
import { human } from '../pki/clock'
import { commonName, dnsNames, hex, organization } from '../pki/parse'
import type { ClientHello } from '../tls/clienthello'
import * as copy from './content'
import { STEPS, type Step } from './lesson'
import { BROWSER_ICON_NOTE, QUESTIONS, TAKEAWAYS } from './quiz'
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

/**
 * One check, compactly.
 *
 * A beginner reads the plain state first -- "Matches", "In date", "Signature
 * verifies" -- and that is often all they need. The long explanation sits
 * behind a per-row disclosure.
 *
 * THE ONE ASYMMETRY: on a FAILURE the cause is shown without being asked for.
 * Progressive disclosure is right for depth and wrong for "why did this just
 * break", which is the only question a reader has at that moment.
 */
function summaryRow(check: Assessment['promises'][number], index: number): HTMLElement {
  const g = outcomeGlyph(check.outcome)
  const failed = check.outcome === 'fail'
  const kids: (Node | string)[] = [
    el('span', { class: 'check-icon', 'aria-hidden': 'true', text: g.icon }),
    el('span', { class: 'summary-name', text: `${index}. ${check.headline}` }),
    el('span', { class: 'summary-state', text: check.plain }),
  ]
  // The cause, always visible when something failed.
  if (failed || check.outcome === 'not-established') {
    kids.push(el('p', { class: 'summary-cause', text: check.detail }))
  }
  // The detail and the evidence, for anyone who wants them.
  const body = el('div', { class: 'details-body' }, [
    failed || check.outcome === 'not-established'
      ? el('p', { class: 'hint', text: `State: ${g.word}.` })
      : el('p', { text: check.detail }),
    list(
      { class: 'evidence', 'aria-label': `What the "${check.headline}" check read` },
      check.evidence.map((e) =>
        el('li', { class: 'evidence-row' }, [
          el('span', { class: 'evidence-label', text: e.label }),
          el('span', { class: 'evidence-value', text: e.value }),
        ]),
      ),
    ),
  ])
  kids.push(
    el('details', { 'data-disclosure': `check-${check.id}` }, [
      el('summary', { text: failed ? 'What exactly was compared' : 'Why this passes, and what it read' }),
      body,
    ]),
  )

  return el('li', {
    class: 'summary-row',
    'data-verdict': check.id,
    'data-result': check.outcome,
  }, kids)
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
      a.promises.map((p, i) => summaryRow(p, i + 1)),
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
      a.nonPromises.map((p, i) => summaryRow(p, i + 1)),
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
    el('details', { 'data-disclosure': 'chain' }, [
      el('summary', { text: copy.CHAIN_HEADING }),
      el('div', { class: 'details-body' }, [
    el('h3', { id: 'chain-h', text: copy.CHAIN_HEADING }),
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
    detailsBytes('Show the certificate fields', fieldTable(a), 'cert-fields'),
      ]),
    ]),
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
function detailsBytes(summaryText: string, body: HTMLElement, key: string): HTMLElement {
  return el('details', { 'data-disclosure': key }, [
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
    el('details', { 'data-disclosure': 'wire' }, [
      el('summary', { text: copy.WIRE_HEADING }),
      el('div', { class: 'details-body' }, [
    el('h3', { id: 'wire-h', text: copy.WIRE_HEADING }),
    el('p', { class: 'lede', text: copy.WIRE_LEDE }),
    // The decoded name FIRST: a beginner should not have to read hex to find
    // out the hostname is readable. The bytes are the evidence, not the lead.
    el('p', { class: 'step-result' }, [
      el('span', { class: 'step-action-label', text: 'THE NAME, IN THE CLEAR' }),
      el('strong', { text: hello.hostnameInBytes }),
    ]),
    detailsBytes('Show the encoded bytes', hexView, 'wire-bytes'),
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
      'wire-parts',
    ),
    el('div', { class: 'callout', 'data-tone': 'alarm' }, [
      el('p', { class: 'callout-title', text: 'WHAT THIS MEANS FOR YOU' }),
      el('p', {
        text:
          `Anyone who can watch your traffic -- your network, your employer, your internet provider -- can read "${asciiName}" ` +
          'out of this message, because no Encrypted ClientHello is used here. What they cannot read is the contents of your traffic -- only that you went there. The site itself, of course, can read what you send it.',
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
      ]),
    ]),
  )
}

/* ── The guided lesson ───────────────────────────────────────────────────── */

export interface StageView {
  readonly mode: 'lesson' | 'explore'
  readonly stepIndex: number
  /** The reader's prediction for this step, or '' if they skipped it. */
  readonly prediction: string
  /** True once the reader has actually performed the step's action. */
  readonly acted: boolean
  readonly change: { what: string; sentence: string }
  readonly onPredict: (optionId: string) => void
  readonly onStep: (next: number) => void
  readonly onMode: (mode: 'lesson' | 'explore') => void
}

function progressBar(current: number): HTMLElement {
  return list(
    { class: 'progress', 'aria-label': 'Lesson progress' },
    STEPS.map((s, i) =>
      el('li', {
        class: 'progress-step',
        'data-done': String(i < current),
        ...(i === current ? { 'aria-current': 'step' } : {}),
      }, [document.createTextNode(`${s.ordinal}. ${s.title}`)]),
    ),
  )
}

/**
 * The prediction. Optional, never gating, and answered BEFORE the action --
 * which is the only order in which being wrong teaches anything.
 */
function predictionBlock(step: Step, chosen: string, onPredict: (id: string) => void): Node {
  const pred = step.prediction
  // An empty TEXT node, not a hidden <span>: a hidden element is a real
  // [hidden] node, and the gate's cascade-trap probe is right to object to one
  // that exists only as a placeholder.
  if (!pred) return document.createTextNode('')
  const answered = chosen !== ''
  const picked = pred.options.find((o) => o.id === chosen)

  return el('div', { class: 'step-result' }, [
    el('span', { class: 'step-action-label', text: 'PREDICT FIRST (OPTIONAL)' }),
    el('p', { text: pred.prompt }),
    list(
      { class: 'options', 'aria-label': pred.prompt },
      pred.options.map((o) => {
        const input = el('input', {
          type: 'radio',
          name: `predict-${step.id}`,
          id: `predict-${step.id}-${o.id}`,
          checked: o.id === chosen,
        })
        input.addEventListener('change', () => input.checked && onPredict(o.id))
        const bits: (Node | string)[] = [
          input,
          el('span', {}, [
            el('span', { text: o.label }),
            // The explanation appears for the option they chose only, so the
            // answer key is not simply on display.
            ...(o.id === chosen ? [el('span', { class: 'option-why', text: o.why })] : []),
          ]),
        ]
        return el('li', {}, [
          el('label', {
            class: 'option',
            for: `predict-${step.id}-${o.id}`,
            ...(o.id === chosen ? { 'data-verdict': o.correct ? 'right' : 'wrong' } : {}),
          }, bits),
        ])
      }),
    ),
    answered
      ? el('p', {
          class: 'hint',
          'data-verdict': 'prediction',
          'data-result': picked?.correct ? 'pass' : 'fail',
          role: 'status',
          text: picked?.correct
            ? 'You predicted correctly. Now do it anyway -- watching it happen is the part that sticks.'
            : 'Not what happens. Do it and watch; the explanation above says why.',
        })
      : document.createTextNode(''),
  ])
}

export function renderStage(host: Element, view: StageView): void {
  const modeRow = el('div', { class: 'mode-row' }, [
    (() => {
      const b = el('button', {
        type: 'button', class: 'btn', id: 'mode-lesson',
        'aria-pressed': String(view.mode === 'lesson'),
        text: 'Guided lesson',
      })
      b.addEventListener('click', () => view.onMode('lesson'))
      return b
    })(),
    (() => {
      const b = el('button', {
        type: 'button', class: 'btn', id: 'mode-explore',
        'aria-pressed': String(view.mode === 'explore'),
        text: 'Explore freely',
      })
      b.addEventListener('click', () => view.onMode('explore'))
      return b
    })(),
  ])

  if (view.mode === 'explore') {
    fill(
      host,
      el('h2', { id: 'stage-h', text: 'Explore freely' }),
      el('p', {
        class: 'lede',
        text: 'Every control is yours. Change the site, the address and the date in any combination, and break the signature whenever you like. The five-step lesson is one click away if you would rather be walked through it.',
      }),
      modeRow,
      el('p', {
        class: 'hint',
        'data-claim': 'step-progress',
        text: 'Free exploration -- no step.',
      }),
      view.change.sentence !== ''
        ? el('p', { class: 'changed', 'data-claim': 'changed', role: 'status', text: view.change.sentence })
        : document.createTextNode(''),
    )
    return
  }

  const step = STEPS[view.stepIndex]!
  const nav = el('div', { class: 'btn-row', style: 'margin-top:.9rem' }, [
    (() => {
      const b = el('button', {
        type: 'button', class: 'btn', id: 'step-prev',
        disabled: view.stepIndex === 0,
        text: 'Back',
      })
      b.addEventListener('click', () => view.onStep(view.stepIndex - 1))
      return b
    })(),
    (() => {
      const last = view.stepIndex === STEPS.length - 1
      const b = el('button', {
        type: 'button', class: 'btn', id: 'step-next',
        'aria-pressed': 'false',
        text: last ? 'Finish, and check what stuck' : `Next: ${STEPS[view.stepIndex + 1]!.title}`,
      })
      b.addEventListener('click', () => view.onStep(view.stepIndex + 1))
      return b
    })(),
  ])

  fill(
    host,
    el('h2', { id: 'stage-h', text: `Step ${step.ordinal} of ${STEPS.length}: ${step.title}` }),
    progressBar(view.stepIndex),
    el('p', {
      class: 'hint',
      'data-claim': 'step-progress',
      text: `Step ${step.ordinal} of ${STEPS.length}.`,
    }),
    el('p', { class: 'step-question', text: step.question }),
    predictionBlock(step, view.prediction, view.onPredict),
    el('div', { class: 'step-action' }, [
      el('span', { class: 'step-action-label', text: 'DO THIS' }),
      el('p', { text: step.action }),
    ]),
    view.change.sentence !== ''
      ? el('p', { class: 'changed', 'data-claim': 'changed', role: 'status', text: view.change.sentence })
      : document.createTextNode(''),
    el('div', { class: 'step-result' }, [
      el('span', { class: 'step-action-label', text: 'WHAT TO LOOK AT' }),
      el('p', { text: step.result }),
    ]),
    el('div', { class: 'step-takeaway' }, [
      el('span', { class: 'step-action-label', text: 'TAKEAWAY' }),
      el('p', { text: step.takeaway }),
    ]),
    nav,
    modeRow,
  )
}

/* ── The closing check ───────────────────────────────────────────────────── */

export interface QuizView {
  readonly visible: boolean
  readonly answers: Readonly<Record<string, string>>
  readonly onAnswer: (questionId: string, optionId: string) => void
  readonly onRevisit: (stepIndex: number) => void
}

export function renderQuiz(host: Element, view: QuizView): void {
  if (!view.visible) {
    fill(
      host,
      el('h2', { id: 'quiz-h', text: 'What stuck' }),
      el('p', {
        class: 'lede',
        text: 'Three questions appear here when you finish the lesson. They are about what you did, not about what you read.',
      }),
    )
    return
  }

  const answered = QUESTIONS.filter((q) => view.answers[q.id]).length
  const right = QUESTIONS.filter((q) => {
    const a = view.answers[q.id]
    return a !== undefined && q.options.find((o) => o.id === a)?.correct === true
  }).length

  fill(
    host,
    el('h2', { id: 'quiz-h', text: 'What stuck' }),
    el('p', {
      class: 'lede',
      text: 'Three questions about what you just did. Nothing is scored and nothing is unlocked -- a wrong answer gets the explanation and an offer to run the experiment again, which is where the answer actually lives.',
    }),
    ...QUESTIONS.map((q) => {
      const chosen = view.answers[q.id] ?? ''
      const picked = q.options.find((o) => o.id === chosen)
      const kids: (Node | string)[] = [
        el('p', { class: 'step-question', text: q.prompt }),
        list(
          { class: 'options', 'aria-label': q.prompt },
          q.options.map((o) => {
            const input = el('input', {
              type: 'radio',
              name: `quiz-${q.id}`,
              id: `quiz-${q.id}-${o.id}`,
              checked: o.id === chosen,
            })
            input.addEventListener('change', () => input.checked && view.onAnswer(q.id, o.id))
            return el('li', {}, [
              el('label', {
                class: 'option',
                for: `quiz-${q.id}-${o.id}`,
                ...(o.id === chosen ? { 'data-verdict': o.correct ? 'right' : 'wrong' } : {}),
              }, [
                input,
                el('span', {}, [
                  el('span', { text: o.label }),
                  ...(o.id === chosen ? [el('span', { class: 'option-why', text: o.why })] : []),
                ]),
              ]),
            ])
          }),
        ),
      ]
      if (chosen !== '') {
        kids.push(
          el('p', {
            class: 'hint',
            'data-verdict': `quiz-${q.id}`,
            'data-result': picked?.correct ? 'pass' : 'fail',
            role: 'status',
            text: picked?.correct ? 'That is right.' : 'Not quite -- the explanation is above.',
          }),
        )
        if (picked?.correct !== true) {
          const again = el('button', {
            type: 'button', class: 'btn', id: `revisit-${q.id}`,
            text: `Try that experiment again (step ${STEPS[q.revisitStep]!.ordinal})`,
          })
          again.addEventListener('click', () => view.onRevisit(q.revisitStep))
          kids.push(el('div', { class: 'btn-row' }, [again]))
        }
      }
      return el('div', { class: 'step-result' }, kids)
    }),
    el('p', {
      class: 'hint',
      'data-claim': 'quiz-progress',
      role: 'status',
      text: `${answered} of ${QUESTIONS.length} answered, ${right} right.`,
    }),
  )
}

/* ── Where to go next, and what to actually do ───────────────────────────── */

export function renderNext(host: Element, recommended: number): void {
  const pick = copy.NEXT[recommended] ?? copy.NEXT[0]!

  fill(
    host,
    el('h2', { id: 'next-h', text: 'Take this away with you' }),
    list(
      { class: 'next-list', 'aria-label': 'What to do about it' },
      TAKEAWAYS.map((text) => el('li', { class: 'next-item', text })),
    ),
    el('div', { class: 'callout', 'data-tone': 'info' }, [
      el('p', { class: 'callout-title', text: 'ABOUT THAT ICON' }),
      el('p', { text: BROWSER_ICON_NOTE }),
    ]),
    el('h3', { text: 'One lab to read next' }),
    el('div', { class: 'next-item' }, [
      el('a', { href: pick.href, target: '_blank', rel: 'noopener noreferrer', text: pick.label }),
      el('p', { class: 'next-item-why', text: pick.why }),
    ]),
    // The rest stay available but stop competing with the recommendation:
    // five equally prominent links are not a next step.
    el('details', { 'data-disclosure': 'next-all' }, [
      el('summary', { text: 'The other labs this one connects to' }),
      el('div', { class: 'details-body' }, [
        list(
          { class: 'next-list', 'aria-label': 'Related labs' },
          copy.NEXT.filter((n) => n.label !== pick.label).map((n) =>
            el('li', { class: 'next-item' }, [
              el('a', { href: n.href, target: '_blank', rel: 'noopener noreferrer', text: n.label }),
              el('p', { class: 'next-item-why', text: n.why }),
            ]),
          ),
        ),
      ]),
    ]),
  )
}
