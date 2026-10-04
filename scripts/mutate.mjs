#!/usr/bin/env node
/*
 * Applies, reverts, or JUDGES the recorded mutations in
 * e2e/verdict-mutations.json. Master template 4.1c.
 *
 *   node scripts/mutate.mjs list
 *   node scripts/mutate.mjs apply <id>
 *   node scripts/mutate.mjs revert <id>
 *   node scripts/mutate.mjs run [id...]      <- the judging loop
 *
 * WHY A JUDGING LOOP AND NOT JUST apply/revert
 *
 * apply/revert leaves the judgement to a person, and the judgement is the part
 * that goes wrong. A mutated run can go red for reasons that are not the
 * verdict: a build error, a server that never started, a port answered by an
 * unmutated checkout. Each looks exactly like a kill in a terminal and is not
 * one. Worse, a patch whose anchor no longer matches applies NOTHING, the suite
 * stays green, and "the mutation survived" becomes indistinguishable from "the
 * harness does not bite".
 *
 * THE FOUR RULES A KILL HAS TO CLEAR, all enforced below:
 *
 *   1. the owning test PASSED unmutated, in this same run;
 *   2. the patch actually CHANGED the file (anchor unique, bytes different);
 *   3. the run served the MUTATED code -- proved two ways, because one is not
 *      enough: the built bundle's hash must move, AND the failure must not
 *      match a shape that means the code never ran at all;
 *   4. the failure is that marker's OWN assertion, not the suite going red --
 *      and a patch that does not compile is DOES NOT BUILD, never a kill.
 *
 * The run happens in an isolated `git archive HEAD` tree with node_modules
 * symlinked, so nothing is judged against the working copy and a crash cannot
 * strand an inverted condition in a file that also holds real work. CI=1 forces
 * playwright.config.ts's `reuseExistingServer: !process.env.CI` to false, so
 * port 4730 cannot be answered by a server an earlier, unmutated run left up.
 *
 * ON WRITING THE EVIDENCE BACK. This loop DOES write its results, to
 * e2e/mutation-evidence.json, and every field in that file is written by the
 * thing that ran it -- the bundle hashes, the baseline test count, the failing
 * test titles, the verdict. None of it is typed by a person, which is the whole
 * requirement: a sentence describing a mutation cannot be replayed, and a
 * paragraph describing a run is the author's side of the claim rather than the
 * run's. Enforcement is separate and lives in e2e/global-teardown.ts, which
 * fails the suite when a recorded kill never executed; the archive is the
 * replayable record, not the check.
 */

import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { connect as netConnect } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const REGISTRY_PATH = join(root, 'e2e', 'verdict-mutations.json')
const EVIDENCE_PATH = join(root, 'e2e', 'mutation-evidence.json')
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
const [command, ...rest] = process.argv.slice(2)

if (command === 'list' || !command) {
  for (const [key, entry] of Object.entries(registry.mutations)) {
    console.log(`${key}\n  ${entry.file}`)
    for (const [marker, kill] of Object.entries(entry.kills ?? {})) {
      console.log(`  kills ${marker} in: ${kill.test}`)
    }
    console.log(`  ${entry.why}\n`)
  }
  process.exit(0)
}

/* ---- apply / revert: one edit, in the working tree ----------------------- */
if (command === 'apply' || command === 'revert') {
  const id = rest[0]
  const entry = registry.mutations[id]
  if (!entry) {
    console.error(`unknown mutation: ${id}`)
    process.exit(2)
  }
  const path = join(root, entry.file)
  const source = readFileSync(path, 'utf8')
  const [from, to] = command === 'apply' ? [entry.find, entry.replace] : [entry.replace, entry.find]
  const occurrences = source.split(from).length - 1
  if (occurrences !== 1) {
    console.error(`refusing: ${entry.file} matched ${occurrences}x, want exactly 1`)
    process.exit(2)
  }
  writeFileSync(path, source.replace(from, to))
  console.log(`${command} ${id} -> ${entry.file}`)
  process.exit(0)
}

if (command !== 'run') {
  console.error(`unknown command: ${command}. Try list, apply, revert or run.`)
  process.exit(2)
}

/* ---- run: the judging loop ---------------------------------------------- */

const ids = rest.length ? rest : Object.keys(registry.mutations)
const unknown = ids.filter((id) => !registry.mutations[id])
if (unknown.length) {
  console.error(`unknown mutation(s): ${unknown.join(', ')}`)
  process.exit(2)
}

const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim()

// `git archive HEAD` cannot see uncommitted work, so a dirty tree would produce
// results about a tree nobody has.
const dirty = git('status', '--porcelain', '--untracked-files=no')
if (dirty && !process.env.MUTATION_ALLOW_DIRTY) {
  console.error('Refusing to run: uncommitted changes to tracked files.\n')
  console.error(dirty)
  console.error('\nThe isolated tree is archived from HEAD and would not contain them.')
  console.error('Commit first. MUTATION_ALLOW_DIRTY=1 overrides, knowing that.')
  process.exit(2)
}
const sha = git('rev-parse', 'HEAD')

/* RULE 2, checked for every selected patch BEFORE any is applied. An
   unreversible patch strands a mutated file and turns every later result into a
   verdict about that file rather than about its own mutation. */
const invalid = []
for (const id of ids) {
  const entry = registry.mutations[id]
  const text = readFileSync(join(root, entry.file), 'utf8')
  const anchors = text.split(entry.find).length - 1
  if (anchors !== 1) {
    invalid.push(`${id}: find occurs ${anchors} times in ${entry.file}, expected 1`)
    continue
  }
  const after = text.replace(entry.find, entry.replace)
  if (after === text) invalid.push(`${id}: the patch is a no-op, it would not change ${entry.file}`)
  else if (after.split(entry.replace).length - 1 !== 1) {
    invalid.push(`${id}: replace occurs more than once after applying, so it cannot be reverted`)
  }
}
if (invalid.length) {
  console.error('Refusing to run: these patches cannot make the round trip.\n')
  for (const line of invalid) console.error(`  ${line}`)
  process.exit(2)
}

/* RULE 3's first precondition, checked before anything is built.
 *
 * CI=1 below forces playwright.config.ts's `reuseExistingServer: false`, which
 * is deliberate -- a reused server could be an UNMUTATED checkout still
 * listening from an earlier run, and a mutation "surviving" against that is a
 * false survivor. But Playwright's own error for an occupied port reads
 * "is already used, make sure that nothing is running on the port/url or set
 * reuseExistingServer:true in config.webServer", which invites exactly the fix
 * that breaks the guarantee. So the port is checked here and named as a
 * precondition instead.
 */
const PORT = 4730

/** Is anything listening on the preview port right now? */
const portInUse = () =>
  new Promise((resolve) => {
    const socket = netConnect({ host: '127.0.0.1', port: PORT })
    const done = (inUse) => {
      socket.destroy()
      resolve(inUse)
    }
    socket.setTimeout(1500, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })

/**
 * Wait for the previous phase's preview server to let go of the port.
 *
 * Every phase of this loop starts its own `vite preview --strictPort` (CI=1, so
 * Playwright never reuses one), and Playwright tears the previous one down when
 * its run ends -- but the socket is not always free by the time the next phase
 * asks for it. When it is not, `--strictPort` refuses, nothing is served, and
 * the suite goes red for a reason that has nothing to do with the mutation.
 *
 * Rule 3's classifier already catches that and reports NOT A KILL rather than a
 * kill, which is correct and useless: the mutation's real verdict is still
 * unknown and the whole run has to be repeated. So wait for the port instead of
 * discovering the collision afterwards. Measured at 14 mutations x 2 phases, the
 * wait is normally zero and occasionally one tick.
 */
async function waitForPortFree(label) {
  for (let i = 0; i < 60; i += 1) {
    if (!(await portInUse())) return true
  }
  console.error(`\n${label}: port ${PORT} never came free. Aborting rather than reporting`)
  console.error('a result about a run that was never served.')
  return false
}

if (await portInUse()) {
  console.error(`Refusing to run: something is already listening on port ${PORT}.`)
  console.error('')
  console.error('This run forces CI=1 so Playwright starts its OWN preview server, because a')
  console.error('reused one could be an unmutated checkout left over from an earlier run --')
  console.error('and a mutation that "survives" against unmutated code is a false survivor.')
  console.error('')
  console.error(`Stop it and re-run:   lsof -ti:${PORT} | xargs kill`)
  console.error('')
  console.error('Do NOT set reuseExistingServer:true to get past this, which is what')
  console.error("Playwright's own message for an occupied port suggests.")
  process.exit(2)
}

const TREE = mkdtempSync(join(tmpdir(), 'padlock-mutation-'))
console.log(`isolated tree: ${TREE}`)
console.log(`archived from: ${sha.slice(0, 7)}`)
console.log(`${ids.length} patches make the round trip.\n`)
execSync(`git -C ${root} archive HEAD | tar -x -C ${TREE}`, { stdio: 'pipe' })
symlinkSync(join(root, 'node_modules'), join(TREE, 'node_modules'))

const sh = (cmd) =>
  execSync(cmd, {
    cwd: TREE,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    maxBuffer: 64 * 1024 * 1024,
  })

const DIST = join(TREE, 'dist', 'assets')
function bundleHash() {
  if (!existsSync(DIST)) return null
  const h = createHash('sha256')
  for (const f of readdirSync(DIST).sort()) h.update(f).update(readFileSync(join(DIST, f)))
  return h.digest('hex').slice(0, 12)
}
const md5 = (rel) => createHash('md5').update(readFileSync(join(TREE, rel))).digest('hex').slice(0, 12)

function build() {
  try {
    sh('npm run build')
    return true
  } catch {
    return false
  }
}

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

/* RULE 3's second half. Red for one of these reasons means the code never ran. */
const NOT_A_KILL = [
  { pattern: /error TS\d+|Build failed|Transform failed|Could not resolve/i, label: 'build error' },
  { pattern: /webServer.*did not start|Timeout .* exceeded while running "beforeAll"/i, label: 'server never started' },
  { pattern: /net::ERR_CONNECTION_REFUSED/i, label: 'nothing served on the port' },
]
const notAKill = (output) => NOT_A_KILL.find(({ pattern }) => pattern.test(strip(output)))?.label ?? null

/* The WHOLE claims+coverage suite, never `-g` on one test.
 *
 * e2e/global-teardown.ts fails the run when any recorded kill did not execute,
 * which is what makes an unperformed record impossible to leave lying around. A
 * single-test run therefore CANNOT exit 0: the named test passes and the
 * teardown fails on the other sixteen. So the suite runs whole, once per phase,
 * and the per-test answer is read out of the reporter. */
async function runSuite(label) {
  if (!(await waitForPortFree(label))) {
    return { failed: true, output: 'PORT_NEVER_FREED', aborted: true }
  }
  const cmd = 'npx playwright test --project=claims --project=coverage --reporter=list --retries=0'
  try {
    return { failed: false, output: sh(cmd) }
  } catch (err) {
    return { failed: true, output: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

/** Failing test titles, as the list reporter prints them: `  N) path:line > title`. */
function failingTitles(output) {
  return [...strip(output).matchAll(/^\s*\d+\)\s+(.+?)(?:\s*[\u2500-]{3,})?\s*$/gm)].map((m) => m[1].trim())
}

function apply(entry, forward) {
  const [from, to] = forward ? [entry.find, entry.replace] : [entry.replace, entry.find]
  const path = join(TREE, entry.file)
  const before = readFileSync(path, 'utf8')
  if (before.split(from).length - 1 !== 1) throw new Error(`${entry.file}: anchor no longer unique`)
  const after = before.replace(from, to)
  if (after === before) throw new Error('the patch produced an identical file: it did not apply')
  writeFileSync(path, after)
}

console.log('building the baseline in the isolated tree...')
if (!build()) {
  console.error('The baseline build fails in the isolated tree. Nothing below would mean anything.')
  rmSync(TREE, { recursive: true, force: true })
  process.exit(2)
}
const baselineHash = bundleHash()
console.log(`baseline bundle ${baselineHash}\n`)

/* RULE 1. If the unmutated suite is already red, a mutation "caught" by it is
   caught by nothing. */
console.log('running the unmutated baseline suite...')
const baseline = await runSuite('baseline')
if (baseline.failed) {
  console.error('The unmutated suite does not pass in the isolated tree. Nothing below would')
  console.error('mean anything: a mutation caught by an already-red suite is caught by nothing.\n')
  console.error(strip(baseline.output).split('\n').slice(-25).join('\n'))
  rmSync(TREE, { recursive: true, force: true })
  process.exit(2)
}
const baselineCount = (strip(baseline.output).match(/(\d+)\s+passed/) || [])[1] ?? '?'
console.log(`baseline suite PASSED (${baselineCount} tests)\n`)

const results = []
for (const id of ids) {
  const entry = registry.mutations[id]
  const markers = Object.entries(entry.kills ?? {})
  process.stdout.write(`${id.padEnd(32)} `)
  try {
    const beforeMd5 = md5(entry.file)
    apply(entry, true)
    const built = build()
    const mutatedHash = built ? bundleHash() : null
    const mutated = built ? await runSuite(id) : { failed: false, output: '' }
    if (mutated.aborted) {
      console.log('ABORTED (port never freed)')
      apply(entry, false)
      rmSync(TREE, { recursive: true, force: true })
      process.exit(2)
    }
    const failed = built ? failingTitles(mutated.output) : []
    const runs = markers.map(([marker, kill]) => [
      marker,
      { failed: failed.some((t) => t.includes(kill.test)), output: mutated.output },
    ])
    apply(entry, false)
    build()
    const restoredHash = bundleHash()
    if (md5(entry.file) !== beforeMd5) {
      console.log('NOT RESTORED')
      console.error(`\n${id}: ${entry.file} did not return to md5 ${beforeMd5}. Aborting.`)
      rmSync(TREE, { recursive: true, force: true })
      process.exit(2)
    }

    const shapes = runs.map(([, r]) => notAKill(r.output)).filter(Boolean)
    const survived = runs.filter(([, r]) => !r.failed).map(([m]) => m)
    const wrongName = runs.filter(([m, r]) => r.failed && !strip(r.output).includes(m)).map(([m]) => m)

    const verdict = !built
      ? 'DOES NOT BUILD'
      : mutatedHash === baselineHash
        ? 'BUNDLE UNCHANGED'
        : shapes.length
          ? `NOT A KILL (${shapes[0]})`
          : survived.length
            ? `SURVIVED (${survived.join(', ')})`
            : wrongName.length
              ? `FAILED FOR THE WRONG REASON (${wrongName.join(', ')})`
              : restoredHash !== baselineHash
                ? 'NOT RESTORED'
                : 'KILLED'

    results.push({
      id,
      verdict,
      markers: markers.map(([m]) => m),
      // Every field here is measured by this loop, never typed.
      observed: {
        baselineBundle: baselineHash,
        mutatedBundle: mutatedHash,
        restoredBundle: restoredHash,
        bundleMoved: mutatedHash !== null && mutatedHash !== baselineHash,
        compiled: built,
        failingTests: failed.filter((t) => markers.some(([, kill]) => t.includes(kill.test))),
      },
    })
    console.log(
      verdict === 'KILLED'
        ? `KILLED  ${baselineHash} -> ${mutatedHash} -> ${restoredHash}  markers: ${markers.map(([m]) => m).join(', ')}`
        : verdict,
    )
  } catch (err) {
    console.log(`ERROR  ${err.message}`)
    console.error('\nAborting: a mutated file left in place makes every later verdict a statement about it.')
    rmSync(TREE, { recursive: true, force: true })
    process.exit(2)
  }
}

rmSync(TREE, { recursive: true, force: true })
const bad = results.filter((r) => r.verdict !== 'KILLED')
const covered = results.reduce((n, r) => n + r.markers.length, 0)

/* The evidence file. Written by the runner, from what the runner measured. */
if (ids.length === Object.keys(registry.mutations).length) {
  writeFileSync(
    EVIDENCE_PATH,
    JSON.stringify(
      {
        comment: [
          'WRITTEN BY scripts/mutate.mjs. Do not edit by hand.',
          '',
          'Every value here was measured by the run that produced it: the bundle hashes come',
          'from hashing dist/assets, `compiled` from whether the build exited 0, and',
          '`failingTests` from the reporter output. Nothing in this file is a person',
          'describing what they saw.',
          '',
          'Regenerate with: npm run test:mutation',
          '',
          'This archive is a replayable record, not the check. The check is',
          'e2e/global-teardown.ts, which fails the suite when a recorded kill never',
          'executed, and e2e/verdict-coverage.spec.ts, which fails a rotted anchor or an',
          'uncovered marker.',
        ],
        ranAt: new Date().toISOString(),
        headSha: sha,
        baselineSuite: { passed: true, tests: Number(baselineCount) || baselineCount },
        killed: results.length - bad.length,
        total: results.length,
        markerAssertionsCovered: covered,
        results,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`\nevidence written to e2e/mutation-evidence.json`)
}

console.log(`\n${results.length - bad.length}/${results.length} mutations killed, covering ${covered} marker assertions.`)
if (bad.length) {
  console.log('\nNot killed:')
  for (const r of bad) console.log(`  ${r.id}: ${r.verdict}`)
  console.log('\nDOES NOT BUILD is a broken PATCH, not a surviving mutation: fix the patch and re-run.')
  console.log('SURVIVED is evidence about the SOURCE or the test, and is the one worth stopping for.')
}
process.exit(bad.length ? 1 : 0)
