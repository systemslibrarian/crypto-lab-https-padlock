import { readFileSync } from 'node:fs'
import { canonicalClaim, readObservations, runId } from './observations'

interface KillRecord {
  test: string
  claim: Record<string, unknown>
}

interface MutationEntry {
  file: string
  find: string
  replace: string
  kills: Record<string, KillRecord>
  why: string
}

/** Separator for composite keys: never appears in a test title or a claim. */
const SEP = ' >>> '

/**
 * The runtime half of the coverage rule.
 *
 * e2e/verdict-coverage.spec.ts asks whether every rendered marker has a
 * recorded mutation. This asks the other question: whether the assertion each
 * mutation record NAMES as its kill actually ran. The answer is read from what
 * expectVerdict / expectClaim EXECUTED, never from the spec's source text -- a
 * mention is not an assertion, and every way a source scan gets defeated is a
 * mention:
 *
 *   - the call commented out: the substring survives, the call does not, and
 *     the (test, marker) pair is never observed;
 *   - the killing assertion rewritten while an unrelated call elsewhere in the
 *     file keeps the id present: a different pair is observed, or the same pair
 *     with a different claim, and neither matches the record;
 *   - the call kept but fed values read off the page in the same test: on the
 *     unmutated baseline that is byte-identical to a correct assertion and no
 *     runtime rule can separate the two -- so the record pins the CLAIM as well
 *     as the pair, and the moment the page moves under the mutation the
 *     tautological argument moves with it and stops matching what was recorded.
 *
 * It runs here rather than in a project with `dependencies:` deliberately: a
 * dependent project is SKIPPED when the project it needs fails, which is
 * exactly the run -- a mutation applied -- where this answer matters most.
 */
export default function globalTeardown(): void {
  const id = runId()
  if (!id) {
    throw new Error(
      'verdict runtime coverage: no run id. e2e/global-setup.ts did not run, so the ' +
        'observation sink was never truncated and nothing it holds can be trusted.',
    )
  }

  const registry = JSON.parse(
    readFileSync(new URL('./verdict-mutations.json', import.meta.url), 'utf8'),
  ) as { mutations: Record<string, MutationEntry> }

  const observed = readObservations(id)

  // A run that did not include the claims project cannot answer this question.
  // Saying so is the difference between "nothing was asserted" and "the
  // selection you ran does not cover the rule".
  if (observed.length === 0) {
    throw new Error(
      'verdict runtime coverage: this run executed no expectVerdict/expectClaim call.\n' +
        'The rule is checked against what ran, so a run that leaves out e2e/claims.spec.ts\n' +
        'cannot answer it. Run `npm run test:verdicts`, or the whole suite, rather than a\n' +
        'narrowed selection.',
    )
  }

  const seenTriples = new Set(observed.map((o) => `${o.test}${SEP}${o.id}${SEP}${o.claim}`))
  const seenPairs = new Set(observed.map((o) => `${o.test}${SEP}${o.id}`))
  const seenIds = new Set(observed.map((o) => o.id))

  const failures: string[] = []
  for (const [mutation, entry] of Object.entries(registry.mutations)) {
    const kills = Object.entries(entry.kills ?? {})
    if (kills.length === 0) {
      failures.push(`${mutation}: records no kill, so it covers no marker`)
      continue
    }
    for (const [marker, kill] of kills) {
      const claim = canonicalClaim(kill.claim)
      if (seenTriples.has(`${kill.test}${SEP}${marker}${SEP}${claim}`)) continue
      if (seenPairs.has(`${kill.test}${SEP}${marker}`)) {
        failures.push(
          `${mutation} -> ${marker}: "${kill.test}" asserted this marker, but never with the ` +
            `recorded killing claim ${claim}`,
        )
      } else if (seenIds.has(marker)) {
        failures.push(
          `${mutation} -> ${marker}: no expectVerdict/expectClaim for this marker executed in ` +
            `"${kill.test}" -- the id is asserted elsewhere in the run, which is not the ` +
            'assertion this record names',
        )
      } else {
        failures.push(
          `${mutation} -> ${marker}: no expectVerdict/expectClaim for this marker executed at all`,
        )
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `verdict runtime coverage: ${failures.length} recorded kill(s) never ran.\n` +
        'Every mutation in e2e/verdict-mutations.json names the test and the claim that kills\n' +
        'it, and each of those had to be OBSERVED executing in this run.\n\n' +
        failures.map((line) => `  - ${line}`).join('\n'),
    )
  }

  const pinned = Object.values(registry.mutations).reduce(
    (total, entry) => total + Object.keys(entry.kills ?? {}).length,
    0,
  )
  console.log(
    `verdict runtime coverage: ${pinned} recorded kills, every one observed executing ` +
      `(${observed.length} helper assertions this run)`,
  )
}
