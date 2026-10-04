import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { boot } from './gate'

/**
 * The static half of the coverage rule. e2e/global-teardown.ts owns the runtime
 * half.
 *
 * Three questions, each of which has a way of going quietly wrong:
 *
 *  1. Does every marker the page RENDERS have a mutation covering it? A verdict
 *     nothing can kill is a verdict no test is pinning, and it reads exactly
 *     like one that is.
 *  2. Does every marker a mutation NAMES still get rendered? A mutation
 *     pointing at a marker the page stopped rendering guards nothing, and its
 *     kill record would be unobservable.
 *  3. Does every mutation's `find` anchor still occur exactly once? A rotted
 *     anchor applies nothing, the suite stays green, and "the mutation
 *     survived" becomes indistinguishable from "the harness does not bite" --
 *     a mistake made twice in this fleet before anything checked for it.
 *
 * The page is driven through the states that render the markers only a failure
 * or the alarm produces, because a marker that exists only in a state nobody
 * reaches cannot be collected from the arrival state alone.
 */

interface Registry {
  mutations: Record<string, { file: string; find: string; replace: string; kills: Record<string, unknown> }>
}

const registry = JSON.parse(
  readFileSync(new URL('./verdict-mutations.json', import.meta.url), 'utf8'),
) as Registry

/** Every marker any mutation claims to kill. */
const covered = new Set(
  Object.values(registry.mutations).flatMap((m) => Object.keys(m.kills)),
)

test('every mutation anchor still occurs exactly once in its file', () => {
  const problems: string[] = []
  for (const [id, m] of Object.entries(registry.mutations)) {
    const source = readFileSync(new URL(`../${m.file}`, import.meta.url), 'utf8')
    const hits = source.split(m.find).length - 1
    if (hits !== 1) problems.push(`${id}: find occurs ${hits}x in ${m.file}, expected exactly 1`)
    const after = source.replace(m.find, m.replace)
    if (after === source) problems.push(`${id}: the patch is a no-op against ${m.file}`)
    else if (after.split(m.replace).length - 1 !== 1) {
      problems.push(`${id}: replace is not unique after applying, so it cannot be reverted`)
    }
  }
  expect(problems, 'rotted mutations guard nothing').toEqual([])
})

test('every mutation records at least one kill', () => {
  const empty = Object.entries(registry.mutations)
    .filter(([, m]) => Object.keys(m.kills).length === 0)
    .map(([id]) => id)
  expect(empty, 'a mutation with no kills covers no marker').toEqual([])
})

test('every marker the page renders is covered by a mutation', async ({ page }) => {
  await boot(page)

  const seen = new Set<string>()
  const collect = async (): Promise<void> => {
    for (const attr of ['data-verdict', 'data-claim']) {
      const ids = await page.locator(`[${attr}]`).evaluateAll((els, a) =>
        els.map((el) => el.getAttribute(a as string) ?? ''), attr)
      for (const id of ids) if (id) seen.add(id)
    }
  }

  // Arrival, then every state that renders a marker the arrival state does not.
  await collect()
  await page.locator('#address-input').fill('evil.example')
  await collect()
  await page.locator('#address-input').fill('github.com')
  await page.locator('#date-input').fill('2027-06-01')
  await collect()
  await page.locator('#date-input').fill('2026-10-04')
  await page.locator('#tamper-btn').click()
  await collect()
  await page.locator('#tamper-btn').click()
  await page.locator('#site-self-signed').check()
  await collect()
  await page.locator('#site-attacker-name').check()
  await collect()

  // The per-link markers are positional: link-0 is pinned by
  // signature-verify-inverted, and the rest are the same renderer with a
  // different index, so they are covered BY CONSTRUCTION rather than one
  // mutation each. Naming the exemption here is what keeps it a decision.
  const positional = (id: string): boolean => /^link-[1-9]\d*$/.test(id)

  const uncovered = [...seen].filter((id) => !covered.has(id) && !positional(id)).sort()
  expect(
    uncovered,
    'these markers are rendered but no mutation in verdict-mutations.json can kill them',
  ).toEqual([])
})

test('every marker a mutation names is still rendered somewhere', async ({ page }) => {
  await boot(page)
  const seen = new Set<string>()
  const collect = async (): Promise<void> => {
    for (const attr of ['data-verdict', 'data-claim']) {
      const ids = await page.locator(`[${attr}]`).evaluateAll((els, a) =>
        els.map((el) => el.getAttribute(a as string) ?? ''), attr)
      for (const id of ids) if (id) seen.add(id)
    }
  }
  await collect()
  await page.locator('#tamper-btn').click()
  await collect()
  await page.locator('#tamper-btn').click()
  await page.locator('#site-attacker-name').check()
  await collect()

  const orphans = [...covered].filter((id) => !seen.has(id)).sort()
  expect(orphans, 'these mutations name markers the page never renders').toEqual([])
})
