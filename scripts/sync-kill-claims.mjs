#!/usr/bin/env node
/*
 * Refresh the CLAIM strings in e2e/verdict-mutations.json from what a passing
 * claims run actually observed.
 *
 *   npm run test:claims        (writes test-results/verdict-observations.ndjson)
 *   node scripts/sync-kill-claims.mjs
 *
 * WHY THIS EXISTS
 *
 * Each recorded kill names a marker, the TEST that kills it, and the exact CLAIM
 * that test asserts. e2e/global-teardown.ts then requires that precise triple to
 * have been observed executing, which is what stops an unperformed record
 * sitting in the registry looking performed.
 *
 * The cost of that precision is that any copy edit to the page invalidates the
 * recorded claim -- correctly, loudly, and tediously. Retyping the new string by
 * hand is exactly the failure the whole mechanism exists to prevent: a person
 * writing down what they believe a run did. So the strings are COPIED from the
 * run's own sink instead.
 *
 * It refuses to invent anything. It will only replace a claim for a
 * (marker, test) pair the sink actually contains, it never adds or removes a
 * kill, and it reports every record it could not match so a real drift -- a
 * renamed test, a deleted assertion -- stays visible rather than being quietly
 * papered over.
 *
 * `--adopt-test` additionally lets a kill follow a RENAMED test, but only when
 * the marker has exactly one observation in the sink, so there is no ambiguity
 * about which assertion is meant.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const REGISTRY = root + 'e2e/verdict-mutations.json'
const SINK = root + 'test-results/verdict-observations.ndjson'
const adoptTest = process.argv.includes('--adopt-test')

let sinkRaw
try {
  sinkRaw = readFileSync(SINK, 'utf8')
} catch {
  console.error('No observation sink. Run the claims suite first:')
  console.error('  CI=1 npx playwright test --project=claims')
  process.exit(2)
}

const observations = sinkRaw
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
if (observations.length === 0) {
  console.error('The sink is empty: no expectVerdict/expectClaim call was observed.')
  process.exit(2)
}

/** marker -> [{test, claim}] */
const byMarker = {}
for (const o of observations) (byMarker[o.id] ??= []).push({ test: o.test, claim: o.claim })

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'))
const changed = []
const adopted = []
const unmatched = []

for (const [id, entry] of Object.entries(registry.mutations)) {
  for (const [marker, kill] of Object.entries(entry.kills ?? {})) {
    const seen = byMarker[marker] ?? []
    const recorded = JSON.stringify(kill.claim)

    // Already correct?
    if (seen.some((s) => s.test === kill.test && s.claim === recorded)) continue

    // Same test, different claim: the copy moved. Take the run's version.
    const sameTest = seen.filter((s) => s.test === kill.test)
    if (sameTest.length === 1) {
      kill.claim = JSON.parse(sameTest[0].claim)
      changed.push(`${id} -> ${marker}: claim updated from the run`)
      continue
    }
    if (sameTest.length > 1) {
      unmatched.push(
        `${id} -> ${marker}: "${kill.test}" asserted this marker ${sameTest.length} times; ` +
          'which one is the kill is a judgement, so it was left alone',
      )
      continue
    }

    // The test itself was renamed. Only adoptable when there is no ambiguity.
    if (adoptTest && seen.length === 1) {
      adopted.push(`${id} -> ${marker}: test "${kill.test}" -> "${seen[0].test}"`)
      kill.test = seen[0].test
      kill.claim = JSON.parse(seen[0].claim)
      continue
    }
    unmatched.push(
      `${id} -> ${marker}: no observation from "${kill.test}"` +
        (seen.length
          ? ` (the marker WAS asserted by: ${seen.map((s) => JSON.stringify(s.test)).join(', ')}` +
            `${adoptTest ? '' : ' -- re-run with --adopt-test if the test was renamed'})`
          : ' and the marker was not asserted at all'),
    )
  }
}

if (changed.length || adopted.length) {
  writeFileSync(REGISTRY, JSON.stringify(registry, null, 2) + '\n')
}
for (const line of adopted) console.log(`ADOPTED  ${line}`)
for (const line of changed) console.log(`UPDATED  ${line}`)
for (const line of unmatched) console.error(`UNMATCHED  ${line}`)
console.log(
  `\n${changed.length} claim(s) updated, ${adopted.length} test name(s) adopted, ` +
    `${unmatched.length} left for a human.`,
)
process.exit(unmatched.length ? 1 : 0)
