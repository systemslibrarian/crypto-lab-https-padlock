import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The RUNTIME denominator for the verdict rules.
 *
 * e2e/verdict-mutations.json records, per marker, the TEST and the exact CLAIM
 * that kills it. The obvious way to enforce that is to scan the spec's source
 * for `expectVerdict(page, '<id>'` -- and that check is defeated three ways,
 * all of them seen in this fleet: comment the call out and the substring
 * survives inside the comment; keep the call but feed it values read off the
 * page in the same test; rewrite the killing assertion and let an unrelated
 * call elsewhere in the file satisfy a file-granular rule. A mention is not an
 * assertion.
 *
 * So the helpers record what they actually EXECUTED, and the rule is checked
 * against that record. Playwright runs tests in separate worker processes, so a
 * module-level Set aggregates nothing; the sink is a file, appended one line at
 * a time with O_APPEND (atomic at this size), truncated by globalSetup before
 * the first worker starts and read back by globalTeardown after the last test.
 * Each line carries the run id globalSetup minted, so a sink that somehow
 * survived truncation cannot satisfy the rule with an earlier run's work.
 *
 * It lives under test-results/ but NOT under outputDir -- Playwright wipes
 * outputDir when a run starts, which would race the truncation.
 * playwright.config.ts points outputDir at test-results/artifacts for exactly
 * that reason.
 */
export const OBSERVATIONS_PATH = fileURLToPath(
  new URL('../test-results/verdict-observations.ndjson', import.meta.url),
)

/** Set by globalSetup, read by the helpers and by globalTeardown. */
export const RUN_ID_ENV = 'PADLOCK_VERDICT_RUN_ID'

export interface Observation {
  run: string
  test: string
  kind: 'verdict' | 'claim'
  id: string
  claim: string
}

/**
 * One claim in one canonical form, so a record in verdict-mutations.json and an
 * argument passed at runtime compare byte-for-byte. Keys sorted; a RegExp
 * becomes its own literal source, which is what the registry stores.
 */
export function canonicalClaim(claim: Readonly<Record<string, unknown>>): string {
  const normalised: Record<string, unknown> = {}
  for (const key of Object.keys(claim).sort()) {
    const value = claim[key]
    if (value === undefined) continue
    normalised[key] = value instanceof RegExp ? String(value) : value
  }
  return JSON.stringify(normalised)
}

export function runId(): string {
  return process.env[RUN_ID_ENV] ?? ''
}

export function resetObservations(id: string): void {
  mkdirSync(dirname(OBSERVATIONS_PATH), { recursive: true })
  writeFileSync(OBSERVATIONS_PATH, '')
  process.env[RUN_ID_ENV] = id
}

export function recordObservation(observation: Observation): void {
  mkdirSync(dirname(OBSERVATIONS_PATH), { recursive: true })
  appendFileSync(OBSERVATIONS_PATH, `${JSON.stringify(observation)}\n`)
}

/** Every observation this run wrote. Lines from any other run are ignored. */
export function readObservations(id: string): Observation[] {
  let raw = ''
  try {
    raw = readFileSync(OBSERVATIONS_PATH, 'utf8')
  } catch {
    return []
  }
  const out: Observation[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line) as Observation
      if (parsed.run === id) out.push(parsed)
    } catch {
      // A torn line cannot be trusted either way; skip it. The teardown's
      // failure mode is "a recorded kill never ran", which a dropped line can
      // only make louder, never quieter.
    }
  }
  return out
}
