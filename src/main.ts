import './style.css'
import { assess, type Assessment } from './pki/assess'
import { tamperSignature } from './pki/break'
import { CLOCK_MAX, CLOCK_MIN, DEFAULT_AT, fromDateInput, toDateInput } from './pki/clock'
import { SCENARIOS, scenario } from './pki/fixtures'
import { freshClientHello, type ClientHello } from './tls/clienthello'
import * as copy from './ui/content'
import { el, fill, list } from './ui/dom'
import { renderChain, renderNonPromises, renderPadlock, renderPromises, renderWire } from './ui/render'

/**
 * The lab's state, and the one function that re-renders from it.
 *
 * Four things a reader can change -- which site, what address they think they
 * are visiting, what date they are checking, and whether the leaf's signature
 * has been tampered with -- and every verdict on the page is recomputed from
 * those four by `assess()`. The UI holds no conclusions of its own.
 */
interface State {
  scenarioId: string
  address: string
  at: Date
  tampered: boolean
}

const state: State = {
  scenarioId: SCENARIOS[0]!.id,
  address: SCENARIOS[0]!.address,
  at: DEFAULT_AT,
  tampered: false,
}

const need = (id: string): HTMLElement => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing mount point: #${id}`)
  return node
}

/* ── Static sections ──────────────────────────────────────────────────────── */

function renderIntro(): void {
  fill(
    need('intro'),
    el('h2', { id: 'intro-h', text: copy.INTRO_HEADING }),
    ...copy.INTRO.map((line, i) => el('p', { class: i === 0 ? 'lede' : undefined, text: line })),
  )
}

function renderScope(): void {
  fill(
    need('scope'),
    el('h2', { id: 'scope-h', text: copy.SCOPE_HEADING }),
    el('h3', { text: 'Real' }),
    list({ class: 'checks', 'aria-label': 'What is real in this lab' },
      copy.SCOPE_REAL.map((t) => el('li', { class: 'next-item', text: t }))),
    el('h3', { text: 'Not real, or not here' }),
    list({ class: 'checks', 'aria-label': 'What this lab does not do' },
      copy.SCOPE_NOT.map((t) => el('li', { class: 'next-item', text: t }))),
  )
}

function renderNext(): void {
  fill(
    need('next'),
    el('h2', { id: 'next-h', text: copy.NEXT_HEADING }),
    list({ class: 'next-list', 'aria-label': 'Related labs' },
      copy.NEXT.map((n) =>
        el('li', { class: 'next-item' }, [
          el('a', { href: n.href, target: '_blank', rel: 'noopener noreferrer', text: n.label }),
          el('p', { class: 'next-item-why', text: n.why }),
        ]),
      )),
  )
}

/* ── Controls ─────────────────────────────────────────────────────────────── */

function renderControls(): void {
  const siteItems = SCENARIOS.map((s) => {
    const input = el('input', {
      type: 'radio',
      name: 'site',
      id: `site-${s.id}`,
      value: s.id,
      checked: s.id === state.scenarioId,
    })
    input.addEventListener('change', () => {
      if (!input.checked) return
      state.scenarioId = s.id
      // The address follows the site, because a reader switching sites is
      // asking about THAT site, not carrying the last one's name across.
      state.address = s.address
      renderControls()
      void refresh()
    })
    return el('li', {}, [
      el('label', { class: 'site-opt', for: `site-${s.id}` }, [
        input,
        el('span', {}, [
          el('span', { class: 'site-opt-name', text: s.site }),
          el('span', { class: 'site-opt-tag', text: s.real ? 'REAL, CAPTURED' : "THIS LAB'S OWN" }),
          el('p', { class: 'site-opt-note', text: s.summary }),
        ]),
      ]),
    ])
  })

  const address = el('input', {
    type: 'text',
    id: 'address-input',
    value: state.address,
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
  })
  address.addEventListener('input', () => {
    state.address = address.value
    void refresh()
  })

  const date = el('input', {
    type: 'date',
    id: 'date-input',
    value: toDateInput(state.at),
    min: toDateInput(CLOCK_MIN),
    max: toDateInput(CLOCK_MAX),
  })
  date.addEventListener('change', () => {
    const parsed = fromDateInput(date.value)
    if (!parsed) {
      date.setAttribute('aria-invalid', 'true')
      return
    }
    date.removeAttribute('aria-invalid')
    state.at = parsed
    void refresh()
  })

  const tamper = el('button', {
    type: 'button',
    class: 'btn',
    id: 'tamper-btn',
    'aria-pressed': String(state.tampered),
  }, [document.createTextNode(state.tampered ? 'Put the signature back' : 'Change one bit of the signature')])
  tamper.addEventListener('click', () => {
    state.tampered = !state.tampered
    renderControls()
    void refresh()
  })

  const reset = el('button', { type: 'button', class: 'btn', id: 'reset-btn', text: 'Start over' })
  reset.addEventListener('click', () => {
    const first = SCENARIOS[0]!
    state.scenarioId = first.id
    state.address = first.address
    state.at = DEFAULT_AT
    state.tampered = false
    renderControls()
    void refresh()
  })

  fill(
    need('controls'),
    el('h2', { id: 'controls-h', text: copy.CONTROLS_HEADING }),
    el('p', { class: 'lede', text: copy.CONTROLS_LEDE }),
    el('fieldset', { class: 'field', style: 'border:0;padding:0;margin:0 0 1rem' }, [
      el('legend', { class: 'field-label', text: 'Which certificate to look at' }),
      list({ class: 'site-list' }, siteItems),
    ]),
    el('div', { class: 'control-grid' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'address-input', text: copy.ADDRESS_LABEL }),
        address,
        el('p', { class: 'hint', text: copy.ADDRESS_HINT }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'date-input', text: copy.DATE_LABEL }),
        date,
        el('p', { class: 'hint', text: copy.DATE_HINT }),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: 'Break it yourself' }),
      el('div', { class: 'btn-row' }, [tamper, reset]),
      el('p', {
        class: 'hint',
        text: 'Flipping one bit of the certificate\'s signature leaves a perfectly well-formed certificate whose signature no longer checks out. The chain walk below really re-checks it.',
      }),
    ]),
  )
}

/* ── The render pass ──────────────────────────────────────────────────────── */

let hello: ClientHello | null = null

async function refresh(): Promise<void> {
  const s = scenario(state.scenarioId)
  // The first message is re-encoded whenever the address changes, because the
  // address is literally what goes in it -- that is the exhibit.
  hello = freshClientHello(state.address || s.site)

  const a: Assessment = await assess(
    {
      scenario: s,
      address: state.address,
      at: state.at,
      tamperedLeaf: state.tampered ? tamperSignature(s.chain[0]!) : undefined,
    },
    {
      hostnameInBytes: hello.hostnameInBytes,
      sniOffset: hello.spans.find((x) => x.label === 'server name')!.start,
      cipherSuiteNames: hello.cipherSuiteNames,
    },
  )

  renderPadlock(need('padlock'), a)
  renderChain(need('chain'), a)
  renderPromises(need('promises'), a)
  renderNonPromises(need('nonpromises'), a)
  renderWire(need('wire'), hello)
}

function boot(): void {
  renderIntro()
  renderControls()
  renderScope()
  renderNext()
  void refresh()
}

boot()
