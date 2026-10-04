import { expect, test, type Locator, type Page } from '@playwright/test'
import { canonicalClaim, recordObservation, runId } from './observations'

/**
 * A marker's text and its state are ONE claim.
 *
 * Asserting a verdict with `toContainText` alone lets a mutation flip the words
 * while leaving `data-result="pass"` in place -- recorded as a kill, with the
 * marker still claiming success in every way a reader can see except the
 * sentence. `expectVerdict` asserts both in a single call and REFUSES a claim
 * carrying only one of them, so the weak shape cannot be written by accident.
 *
 * Each call that PASSES then records itself -- the test that ran it, the marker
 * it asserted, the claim it asserted -- into the run-scoped sink. Recording
 * happens after the assertions, never before: "observed" means the claim
 * executed and held, not that a call was reached.
 */
export interface VerdictClaim {
  /** Assert against this descendant of the marker rather than the marker itself. */
  within?: string
  /** Assert text against this descendant of `within` (state stays on `within`). */
  label?: string
  text?: string
  contains?: string | readonly string[]
  absent?: string | readonly string[]
  /** `data-result` on the marker (or on `within`). */
  result?: string
  /** Class list of the marker (or of `within`). */
  klass?: RegExp
}

const list = (value: string | readonly string[] | undefined): readonly string[] =>
  value === undefined ? [] : typeof value === 'string' ? [value] : value

function scopeFor(marker: Locator, claim: VerdictClaim): { state: Locator; text: Locator } {
  const state = claim.within ? marker.locator(claim.within) : marker
  return { state, text: claim.label ? state.locator(claim.label) : state }
}

function observe(
  kind: 'verdict' | 'claim',
  id: string,
  claim: Readonly<Record<string, unknown>>,
): void {
  recordObservation({
    run: runId(),
    test: test.info().title,
    kind,
    id,
    claim: canonicalClaim(claim),
  })
}

async function applyClaim(marker: Locator, id: string, claim: VerdictClaim): Promise<void> {
  const { state, text } = scopeFor(marker, claim)
  if (claim.text !== undefined) await expect(text, `${id}: text`).toHaveText(claim.text)
  for (const c of list(claim.contains)) await expect(text, `${id}: contains`).toContainText(c)
  for (const a of list(claim.absent)) await expect(text, `${id}: absent`).not.toContainText(a)
  if (claim.result !== undefined) {
    await expect(state, `${id}: data-result`).toHaveAttribute('data-result', claim.result)
  }
  if (claim.klass !== undefined) await expect(state, `${id}: class`).toHaveClass(claim.klass)
}

export async function expectVerdict(
  page: Page,
  id: string,
  ...claims: readonly VerdictClaim[]
): Promise<void> {
  const marker = page.locator(`[data-verdict="${id}"]`)
  await expect(marker, `the page must render exactly one [data-verdict="${id}"]`).toHaveCount(1)
  expect(claims.length, `expectVerdict('${id}') was called with no claim`).toBeGreaterThan(0)

  for (const claim of claims) {
    // A verdict claim must pin BOTH the words and the state. One without the
    // other is the weak shape described above.
    const hasText = claim.text !== undefined || claim.contains !== undefined
    const hasState = claim.result !== undefined || claim.klass !== undefined
    expect(
      hasText && hasState,
      `expectVerdict('${id}') needs BOTH a text claim (text/contains) and a state claim ` +
        `(result/klass) in the same call -- see e2e/expect-verdict.ts`,
    ).toBe(true)
    await applyClaim(marker, id, claim)
    observe('verdict', id, { ...claim })
  }
}

/**
 * A measurement rather than a verdict: `data-claim` markers carry a computed
 * number or string with no pass/fail of their own, so they are allowed a
 * text-only claim.
 */
export async function expectClaim(
  page: Page,
  id: string,
  ...claims: readonly VerdictClaim[]
): Promise<void> {
  const marker = page.locator(`[data-claim="${id}"]`)
  await expect(marker, `the page must render exactly one [data-claim="${id}"]`).toHaveCount(1)
  expect(claims.length, `expectClaim('${id}') was called with no claim`).toBeGreaterThan(0)
  for (const claim of claims) {
    await applyClaim(marker, id, claim)
    observe('claim', id, { ...claim })
  }
}
