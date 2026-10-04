import { expect, test } from '@playwright/test'
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  FLOOR,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate'

/**
 * WCAG 2.1 A/AA regression gate.
 *
 * The lab is driven along everything it teaches, and every one of those states
 * is scanned: the arrival state with the real github.com chain and all four
 * promises passing; the shared skip link focused; the name check failed on a
 * mismatched address, passed on a second SAN, and failed CLOSED on a string
 * that is not a hostname at all; the clock moved past expiry and then before
 * the window opens; one bit of the signature flipped so the vouching check
 * goes red while nothing else moves; both disclosures opened through their own
 * summaries and shut again; the self-signed chain that nobody vouched for;
 * the attacker chain whose every check passes and whose verdict is ALARM
 * rather than green; a hovered site row; three focus rings; and the reset back
 * to arrival through the page's own control.
 *
 * THREE WIDTHS, because dark is the only theme and the reflow axis is the one
 * that carries risk here: 1280 desktop, 390 for a current phone, and 320 --
 * the narrowest width WCAG 1.4.10 is written against, and the width at which
 * the shared top bar deliberately stops widening its touch targets.
 *
 * See `gate.ts` for why nothing is injected into the page, why no disclosure
 * is opened from script, why the lab's defaults are asserted rather than
 * assumed, and why `violations` is not the whole oracle.
 */

const WIDTHS = [
  { name: '1280px desktop', size: null },
  { name: '390px phone', size: NARROW },
  { name: '320px reflow floor', size: FLOOR },
] as const

for (const width of WIDTHS) {
  test(`no WCAG A/AA violations at ${width.name}`, async ({ page }) => {
    test.setTimeout(1_800_000)
    const errors = watchPageErrors(page)
    if (width.size) await page.setViewportSize(width.size)
    await boot(page)
    await driveAllStates(page, width.name)
    expect(errors, errors.join('\n')).toEqual([])
    expectBaselineNotStale()
    reportCollected()
  })
}
