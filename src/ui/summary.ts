import type { Assessment } from '../pki/assess'
import type { Outcome } from '../pki/types'

/**
 * "Changed: the checking date. The certificate expired. Its name and signatures
 * still check out."
 *
 * A causal sentence after every action, because the page recomputes eight
 * verdicts at once and a reader who moved one control needs to know which of
 * them moved because of it. Without this the lab shows a new state and leaves
 * the reader to diff it against a memory of the old one.
 *
 * It is computed by comparing the previous outcomes with the new ones, so it
 * cannot drift from what the checks actually did -- and it names what STAYED
 * THE SAME as well, which is the whole point of the expiry step: nothing
 * cryptographic changed.
 */

export type Outcomes = Readonly<Record<string, Outcome>>

export function outcomesOf(a: Assessment): Outcomes {
  const out: Record<string, Outcome> = {}
  for (const c of [...a.promises, ...a.nonPromises]) out[c.id] = c.outcome
  return out
}

/** Human names for the four promises, for the sentence. */
const NAME: Record<string, string> = {
  'promise-key': 'the key',
  'promise-name': 'the name',
  'promise-vouched': 'the signatures',
  'promise-time': 'the dates',
}

const list = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`

export interface Change {
  /** What the reader altered, in their words. '' on first paint. */
  readonly what: string
  readonly sentence: string
}

export function summarise(
  what: string,
  before: Outcomes | null,
  after: Outcomes,
): Change {
  if (what === '' || before === null) {
    return { what: '', sentence: '' }
  }

  const promiseIds = Object.keys(NAME)
  const broke = promiseIds.filter((id) => before[id] === 'pass' && after[id] === 'fail')
  const fixed = promiseIds.filter((id) => before[id] === 'fail' && after[id] === 'pass')
  const stillFine = promiseIds.filter((id) => after[id] === 'pass')

  const parts: string[] = [`Changed: ${what}.`]
  if (broke.length > 0) {
    parts.push(`${cap(list(broke.map((id) => NAME[id]!)))} now ${broke.length === 1 ? 'fails' : 'fail'}.`)
  }
  if (fixed.length > 0) {
    parts.push(`${cap(list(fixed.map((id) => NAME[id]!)))} ${fixed.length === 1 ? 'passes' : 'pass'} again.`)
  }
  if (broke.length === 0 && fixed.length === 0) {
    parts.push('No check changed its answer.')
  } else if (stillFine.length > 0) {
    // Naming what did NOT move is the expiry lesson in one clause.
    parts.push(`${cap(list(stillFine.map((id) => NAME[id]!)))} still check out.`)
  }
  return { what, sentence: parts.join(' ') }
}

const cap = (s: string): string => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1))
