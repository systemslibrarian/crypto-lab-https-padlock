import './style.css'
import { assess, type Assessment } from './pki/assess'
import { tamperSignature } from './pki/break'
import { CLOCK_MAX, CLOCK_MIN, DEFAULT_AT, fromDateInput, human, toDateInput } from './pki/clock'
import { SCENARIOS, scenario } from './pki/fixtures'
import { hostFromInput } from './pki/hostname'
import { parsePem } from './pki/parse'
import { freshClientHello } from './tls/clienthello'
import * as copy from './ui/content'
import { defineTerm, el, fill, list } from './ui/dom'
import { term } from './ui/glossary'
import { LAST_STEP, STEPS } from './ui/lesson'
import {
  renderChain, renderNext, renderNonPromises, renderPadlock, renderPromises, renderQuiz,
  renderStage, renderWire,
} from './ui/render'
import { outcomesOf, summarise, type Change, type Outcomes } from './ui/summary'

/**
 * The lab's state, and the one function that re-renders from it.
 *
 * The guided lesson is the DEFAULT. Everything the lesson does, it does by
 * driving the same four inputs explore mode exposes -- which site, what address
 * the reader thinks they are visiting, what date they are checking, and whether
 * the leaf's signature has been tampered with. Every verdict on the page is
 * recomputed from those four by `assess()`. The UI holds no conclusions.
 */
interface State {
  mode: 'lesson' | 'explore'
  step: number
  scenarioId: string
  address: string
  at: Date
  tampered: boolean
  /** Per-step prediction, keyed by step id. */
  predictions: Record<string, string>
  /** Quiz answers, keyed by question id. */
  answers: Record<string, string>
  /** True once the reader has reached the end of the lesson. */
  finished: boolean
  /** What the reader last changed, for the causal summary. */
  lastChange: string
}

const firstStep = STEPS[0]!

const state: State = {
  mode: 'lesson',
  step: 0,
  scenarioId: firstStep.baseline.scenarioId,
  address: firstStep.baseline.address,
  at: DEFAULT_AT,
  tampered: false,
  predictions: {},
  answers: {},
  finished: false,
  lastChange: '',
}

/** Outcomes from the previous render, for the "Changed: ..." sentence. */
let previous: Outcomes | null = null
let change: Change = { what: '', sentence: '' }

const need = (id: string): HTMLElement => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing mount point: #${id}`)
  return node
}

/* ── Keeping the reader's place across a re-render ────────────────────────── */

/**
 * Focus and disclosure state survive a re-render.
 *
 * Every action replaces the controls, so without this a click on "Change one
 * bit" dropped focus to the body -- a keyboard reader lost their place on every
 * single interaction -- and an open "Show the certificate fields" closed itself
 * the moment the address was edited. Both were reported from a real pass
 * through the lab.
 *
 * Elements are re-found by id and by `data-disclosure`, not by object identity,
 * because the nodes genuinely are new ones.
 */
function captureFocus(): { id: string; start: number | null } | null {
  const a = document.activeElement as HTMLElement | null
  if (!a || !a.id || a === document.body) return null
  const input = a as HTMLInputElement
  const start = typeof input.selectionStart === 'number' ? input.selectionStart : null
  return { id: a.id, start }
}

function restoreFocus(saved: { id: string; start: number | null } | null): void {
  if (!saved) return
  const node = document.getElementById(saved.id)
  if (!node) return
  node.focus()
  if (saved.start !== null) {
    const input = node as HTMLInputElement
    try {
      input.setSelectionRange(saved.start, saved.start)
    } catch {
      // Not a text input any more. Focus is the part that mattered.
    }
  }
}

const openDisclosures = new Set<string>()

function captureDisclosures(): void {
  for (const d of document.querySelectorAll<HTMLDetailsElement>('details[data-disclosure]')) {
    const key = d.dataset.disclosure
    if (!key) continue
    if (d.open) openDisclosures.add(key)
    else openDisclosures.delete(key)
  }
}

function restoreDisclosures(): void {
  for (const d of document.querySelectorAll<HTMLDetailsElement>('details[data-disclosure]')) {
    const key = d.dataset.disclosure
    if (key && openDisclosures.has(key)) d.open = true
  }
}

/* ── Static sections ──────────────────────────────────────────────────────── */

function renderIntro(): void {
  const start = el('button', { type: 'button', class: 'btn', id: 'start-lesson' }, [
    document.createTextNode('Start the five-step lesson'),
  ])
  start.addEventListener('click', () => {
    setMode('lesson')
    goToStep(0)
  })
  const explore = el('button', { type: 'button', class: 'btn', id: 'start-explore' }, [
    document.createTextNode('Explore freely instead'),
  ])
  explore.addEventListener('click', () => setMode('explore'))

  fill(
    need('intro'),
    el('h2', { id: 'intro-h', text: copy.INTRO_HEADING }),
    // TWO sentences. The intro was three paragraphs, which is a wall of text
    // between a newcomer and their first action.
    el('p', { class: 'lede' }, [
      document.createTextNode(
        'When your browser shows a padlock it has checked a short, specific list of things -- shorter than almost everyone assumes, and silent about the people behind the name. ',
      ),
      document.createTextNode('This page takes a real '),
      // The one word a newcomer may not know, defined where it first appears.
      defineTerm(term('certificate').word, term('certificate').definition, 'intro-certificate'),
      document.createTextNode(
        ' apart, lets you break each check yourself, and then shows you a flawless certificate for a site you would never want to visit.',
      ),
    ]),
    el('div', { class: 'btn-row' }, [start, explore]),
  )
}

function renderScope(): void {
  fill(
    need('scope'),
    el('details', { 'data-disclosure': 'scope' }, [
      el('summary', { text: copy.SCOPE_HEADING }),
      el('div', { class: 'details-body' }, [
        el('h3', { id: 'scope-h', text: copy.SCOPE_HEADING }),
        el('h4', { text: 'Real' }),
        list({ class: 'next-list', 'aria-label': 'What is real in this lab' },
          copy.SCOPE_REAL.map((t) => el('li', { class: 'next-item', text: t }))),
        el('h4', { text: 'Not real, or not here' }),
        list({ class: 'next-list', 'aria-label': 'What this lab does not do' },
          copy.SCOPE_NOT.map((t) => el('li', { class: 'next-item', text: t }))),
      ]),
    ]),
  )
}

/* ── Controls ─────────────────────────────────────────────────────────────── */

/** Which controls the current context shows. The lesson shows only its own. */
function activeControls(): readonly ('site' | 'address' | 'date' | 'tamper')[] {
  if (state.mode === 'explore') return ['site', 'address', 'date', 'tamper']
  const step = STEPS[state.step]!
  // Step 1 has no action of its own, so show the reader the site they are
  // looking at rather than an empty panel.
  return step.controls.length > 0 ? step.controls : ['site']
}

/**
 * Date presets, derived from the certificate the reader is actually looking at.
 *
 * Typing a date into a date input to see an expiry failure is work, and work
 * between a reader and a lesson is lost readers. These come from the parsed
 * notBefore/notAfter of the current leaf, so they are correct for whichever
 * certificate is selected rather than hardcoded to one of them.
 */
function datePresets(): { id: string; label: string; date: string; hint: string }[] {
  const leaf = parsePem(scenario(state.scenarioId).chain[0]!)
  const day = 24 * 60 * 60 * 1000
  const before = new Date(leaf.notBefore.getTime() - day)
  const after = new Date(leaf.notAfter.getTime() + day)
  const middle = new Date((leaf.notBefore.getTime() + leaf.notAfter.getTime()) / 2)
  const out = [
    { id: 'valid', label: 'While it is valid', date: toDateInput(middle), hint: `${human(middle)} -- inside the window` },
    { id: 'expired', label: 'Day after expiry', date: toDateInput(after), hint: `${human(after)} -- one day too late` },
    { id: 'early', label: 'Day before it starts', date: toDateInput(before), hint: `${human(before)} -- one day too early` },
  ]
  // The clock control has a range; a preset outside it would set a value the
  // input silently refuses, which looks like a broken button.
  return out.filter((o) => {
    const d = fromDateInput(o.date)
    return d !== null && d >= CLOCK_MIN && d <= CLOCK_MAX
  })
}

function renderControls(): void {
  const show = activeControls()
  const blocks: HTMLElement[] = []

  if (show.includes('site')) {
    const items = SCENARIOS.map((s) => {
      const input = el('input', {
        type: 'radio', name: 'site', id: `site-${s.id}`, value: s.id,
        checked: s.id === state.scenarioId,
      })
      input.addEventListener('change', () => {
        if (!input.checked) return
        state.scenarioId = s.id
        state.address = s.address
        // Switching site CLEARS the tamper. Carrying it across made the
        // lookalike's caption ("Every check passes") a lie about the state the
        // reader was actually in.
        state.tampered = false
        act(`the site, to ${s.site}`)
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
    blocks.push(
      el('fieldset', { class: 'field', style: 'border:0;padding:0;margin:0' }, [
        el('legend', { class: 'field-label', text: 'Which certificate to look at' }),
        list({ class: 'site-list' }, items),
      ]),
    )
  }

  if (show.includes('address')) {
    const hintId = 'address-hint'
    const address = el('input', {
      type: 'text', id: 'address-input', value: state.address,
      spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
      'aria-describedby': hintId,
    })
    address.addEventListener('input', () => {
      state.address = (address as HTMLInputElement).value
      act('the address')
    })
    blocks.push(
      el('div', { class: 'field' }, [
        el('label', { for: 'address-input', text: copy.ADDRESS_LABEL }),
        address,
        el('p', { class: 'hint', id: hintId, text: copy.ADDRESS_HINT }),
      ]),
    )
  }

  if (show.includes('date')) {
    const hintId = 'date-hint'
    const errId = 'date-error'
    const date = el('input', {
      type: 'date', id: 'date-input', value: toDateInput(state.at),
      min: toDateInput(CLOCK_MIN), max: toDateInput(CLOCK_MAX),
      'aria-describedby': `${hintId} ${errId}`,
    })
    const error = el('p', { class: 'hint', id: errId, role: 'status' })
    date.addEventListener('change', () => {
      const parsed = fromDateInput((date as HTMLInputElement).value)
      if (!parsed) {
        date.setAttribute('aria-invalid', 'true')
        error.textContent = 'That is not a date this lab can check. Use the buttons, or type a day between 2025 and 2027.'
        return
      }
      date.removeAttribute('aria-invalid')
      error.textContent = ''
      state.at = parsed
      act('the checking date')
    })

    const presets = datePresets().map((pre) => {
      const b = el('button', {
        type: 'button', class: 'preset', id: `preset-${pre.id}`,
        'aria-pressed': String(toDateInput(state.at) === pre.date),
        title: pre.hint,
      }, [document.createTextNode(pre.label)])
      b.addEventListener('click', () => {
        const parsed = fromDateInput(pre.date)
        if (!parsed) return
        state.at = parsed
        act('the checking date')
      })
      return b
    })

    blocks.push(
      el('div', { class: 'field' }, [
        el('label', { for: 'date-input', text: copy.DATE_LABEL }),
        el('div', { class: 'preset-row' }, presets),
        date,
        el('p', { class: 'hint', id: hintId, text: copy.DATE_HINT }),
        error,
      ]),
    )
  }

  if (show.includes('tamper')) {
    const hintId = 'tamper-hint'
    const tamper = el('button', {
      type: 'button', class: 'btn', id: 'tamper-btn',
      'aria-pressed': String(state.tampered),
      'aria-describedby': hintId,
    }, [document.createTextNode(state.tampered ? 'Put the signature back' : 'Change one bit of the signature')])
    tamper.addEventListener('click', () => {
      state.tampered = !state.tampered
      act(state.tampered ? 'one bit of the signature' : 'the signature, back to the original')
    })
    blocks.push(
      el('div', { class: 'field' }, [
        el('span', { class: 'field-label', text: 'Break it yourself' }),
        el('div', { class: 'btn-row' }, [tamper]),
        el('p', { class: 'hint', id: hintId, text: 'Flipping one bit leaves a perfectly well-formed certificate whose signature no longer checks out. The chain below really re-checks it.' }),
      ]),
    )
  }

  const reset = el('button', { type: 'button', class: 'btn', id: 'reset-btn', text: 'Reset this step' })
  reset.addEventListener('click', () => {
    applyBaseline()
    act('')
  })

  /** State badges: a reader must never wonder what they have left switched on. */
  const badges: HTMLElement[] = []
  if (state.tampered) badges.push(el('li', { class: 'badge', text: 'SIGNATURE ALTERED' }))
  if (toDateInput(state.at) !== toDateInput(DEFAULT_AT)) {
    badges.push(el('li', { class: 'badge', text: `LAB DATE: ${human(state.at)}` }))
  }
  const s = scenario(state.scenarioId)
  if (hostFromInput(state.address) !== s.address) {
    badges.push(el('li', { class: 'badge', text: `ADDRESS: ${state.address || '(empty)'}` }))
  }
  if (badges.length === 0) {
    badges.push(el('li', { class: 'badge', 'data-tone': 'neutral', text: 'NOTHING CHANGED YET' }))
  }

  fill(
    need('controls'),
    el('h2', { id: 'controls-h', text: state.mode === 'lesson' ? 'Your controls for this step' : copy.CONTROLS_HEADING }),
    el('p', { class: 'lede', text: copy.CONTROLS_LEDE }),
    ...blocks,
    list({ class: 'badges', 'aria-label': 'What you have changed' }, badges),
    el('div', { class: 'btn-row', style: 'margin-top:.7rem' }, [reset]),
  )
}

/* ── The render pass ──────────────────────────────────────────────────────── */

let renderToken = 0

async function refresh(): Promise<void> {
  const token = ++renderToken
  const s = scenario(state.scenarioId)
  const input = { address: state.address, at: state.at, tampered: state.tampered }

  const hello = await freshClientHello(hostFromInput(input.address) || s.site)

  const a: Assessment = await assess(
    {
      scenario: s,
      address: input.address,
      at: input.at,
      tamperedLeaf: input.tampered ? tamperSignature(s.chain[0]!) : undefined,
    },
    {
      hostnameInBytes: hello.hostnameInBytes,
      sniOffset: hello.spans.find((x) => x.label === 'server name')!.start,
      cipherSuiteNames: hello.cipherSuiteNames,
    },
  )

  if (token !== renderToken) return

  const next = outcomesOf(a)
  change = summarise(state.lastChange, previous, next)
  previous = next

  const saved = captureFocus()
  captureDisclosures()

  renderStage(need('stage'), {
    mode: state.mode,
    stepIndex: state.step,
    prediction: state.predictions[STEPS[state.step]!.id] ?? '',
    acted: state.lastChange !== '',
    change,
    onPredict: (optionId) => {
      state.predictions[STEPS[state.step]!.id] = optionId
      void refresh()
    },
    onStep: goToStep,
    onMode: setMode,
  })
  renderControls()
  renderPadlock(need('padlock'), a)
  renderPromises(need('promises'), a)
  renderNonPromises(need('nonpromises'), a)
  renderQuiz(need('quiz'), {
    visible: state.mode === 'explore' || state.finished,
    answers: state.answers,
    onAnswer: (qid, oid) => {
      state.answers[qid] = oid
      void refresh()
    },
    onRevisit: (stepIndex) => {
      setMode('lesson')
      goToStep(stepIndex)
    },
  })
  renderChain(need('chain'), a)
  renderWire(need('wire'), hello)
  renderScope()
  // The recommended next lab follows the last step the reader was on: chain,
  // handshake or hostname privacy, rather than five equal links.
  renderNext(need('next'), state.step >= 4 ? 0 : state.step >= 2 ? 1 : 2)

  restoreDisclosures()
  restoreFocus(saved)
}

/* ── Transitions ──────────────────────────────────────────────────────────── */

/** Record what changed, then re-render. '' means "no causal summary". */
function act(what: string): void {
  state.lastChange = what
  void refresh()
}

function applyBaseline(): void {
  const b = STEPS[state.step]!.baseline
  state.scenarioId = b.scenarioId
  state.address = b.address
  const parsed = fromDateInput(b.date)
  if (parsed) state.at = parsed
  state.tampered = b.tampered
}

function goToStep(next: number): void {
  if (next > LAST_STEP) {
    state.finished = true
    state.lastChange = ''
    void refresh()
    document.getElementById('quiz')?.scrollIntoView({ block: 'start' })
    return
  }
  state.step = Math.max(0, Math.min(LAST_STEP, next))
  // Every step starts from a known baseline, so it cannot inherit the previous
  // step's half-finished experiment.
  applyBaseline()
  state.lastChange = ''
  previous = null
  void refresh()
}

function setMode(mode: 'lesson' | 'explore'): void {
  state.mode = mode
  if (mode === 'lesson') applyBaseline()
  state.lastChange = ''
  previous = null
  void refresh()
}

function boot(): void {
  renderIntro()
  void refresh()
}

boot()
