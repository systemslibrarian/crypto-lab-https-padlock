import { expect, test, type Page } from '@playwright/test'
import { expectClaim, expectVerdict } from './expect-verdict'
import { boot } from './gate'

/**
 * The claims suite: what this lab's interface SAYS and what it COMPUTES, as
 * opposed to what it is shaped like. Master template 4.1b and 4.1d.
 *
 * These live here rather than in `boot()` for the reason 4.1a gives: a copy
 * edit must fail a test named "claims", not every test in the accessibility
 * gate at once under a name that points at the wrong subject.
 *
 * THE RULE THAT MAKES THESE WORTH ANYTHING: compare two values the page itself
 * printed, or RE-DERIVE the claim from the page's raw inputs by a different
 * route than the source takes. A test that recomputes the same expression the
 * source uses will happily agree with a bug -- so the three biggest claims
 * here (name matching, expiry, the SNI offset) are each re-derived
 * independently, in this file, from values read off the screen.
 */


/**
 * Boot into EXPLORE mode, where every control is on screen at once.
 *
 * The guided lesson is the arrival state and shows only the controls its
 * current step needs, which is the point of it -- so a test about one control
 * in isolation has to say which mode it means. Tests about the lesson itself
 * use `boot` and walk the steps.
 */
async function bootExplore(page: Page): Promise<void> {
  await boot(page)
  await page.locator('#mode-explore').click()
  await expect(page.locator('#address-input')).toHaveCount(1)
}

const read = async (page: Page, selector: string): Promise<string> =>
  ((await page.locator(selector).textContent()) ?? '').trim()

/** The value cell of one evidence row, found by its label. */
async function evidence(page: Page, scope: string, label: string): Promise<string> {
  const row = page.locator(`${scope} .evidence-row`, { hasText: label })
  return ((await row.locator('.evidence-value').first().textContent()) ?? '').trim()
}

test.describe('the headline verdict', () => {
  test('the padlock verdict reports the computed outcome, not a canned banner', async ({ page }) => {
    await boot(page)
    await expectVerdict(page, 'padlock', {
      contains: 'PADLOCK SHOWN',
      result: 'pass',
    })
    // Cross-check: the headline says the padlock shows, so every promise row
    // must be passing. Two surfaces that have to agree.
    await expect(page.locator('#promises .summary-row[data-result="pass"]')).toHaveCount(4)
    await expect(page.locator('#promises .summary-row[data-result="fail"]')).toHaveCount(0)
  })

  test('the chain-length claim equals the boxes the page actually drew', async ({ page }) => {
    await boot(page)
    const steps = await page.locator('#chain .walk-step').count()
    const links = await page.locator('#chain .walk-link').count()
    // The sentence is generated from the same assessment that drew the boxes,
    // so this is the counter-versus-the-rows cross-check 4.1b asks for.
    await expectClaim(page, 'chain-length', {
      text: `${steps} certificates in the walk, ${links} signatures checked.`,
    })
  })

  test('signatures-checked sums to the number of links drawn', async ({ page }) => {
    await boot(page)
    const links = await page.locator('#chain .walk-link').count()
    const checked = await evidence(page, '[data-verdict="promise-vouched"]', 'Signatures checked')
    // parts-sum-to-whole: "N of M" where M is the links on screen.
    expect(checked).toBe(`${links} of ${links}`)
  })
})

test.describe('promise 1, the key', () => {
  test('the key check reports the curve the certificate actually carries', async ({ page }) => {
    await bootExplore(page)
    await expectVerdict(page, 'promise-key', {
      contains: 'The certificate carries a usable key',
      result: 'pass',
    })
    // The claim is about a parsed field, so it is checked against the field:
    // github.com's leaf is P-256, which openssl agrees with in
    // src/pki/kat.test.ts.
    expect(await evidence(page, '[data-verdict="promise-key"]', 'Key type'))
      .toBe('elliptic curve (P-256)')
    // The page says WebCrypto loaded it, which is the measurement rather than
    // the parsed field beside it.
    expect(await evidence(page, '[data-verdict="promise-key"]', 'Loaded by your browser'))
      .toBe('yes')
    // And it is honest about what the key is FOR. In TLS 1.3 the certificate's
    // key checks a handshake signature; it is not the key traffic is encrypted
    // to -- that was RSA key transport, which TLS 1.3 removed. Saying "a key to
    // encrypt to" taught a beginner something false while every test stayed
    // green, so the correction is pinned here.
    expect(await evidence(page, '[data-verdict="promise-key"]', 'What this key is for'))
      .toBe("checking the server's handshake signature")
    expect(await evidence(page, '[data-verdict="promise-key"]', 'Encrypts your traffic'))
      .toContain('no')
    await expectVerdict(page, 'promise-key', {
      contains: 'Neither step happens in this lab',
      result: 'pass',
    })
  })
})

test.describe('promise 2, the name check, re-derived independently', () => {
  /**
   * RFC 6125 matching, implemented a second time HERE, in the test, from the
   * names the page printed. It shares no code with src/pki/hostname.ts, so a
   * bug in that module cannot be ratified by this assertion.
   */
  function matchesIndependently(address: string, sans: readonly string[]): boolean {
    const a = address.trim().toLowerCase().replace(/\.$/, '')
    if (a === '' || !/^[a-z0-9.-]+$/.test(a)) return false
    if (a.split('.').some((l) => l === '' || l.startsWith('-') || l.endsWith('-'))) return false
    return sans.some((raw) => {
      const s = raw.trim().toLowerCase()
      if (!s.startsWith('*.')) return s === a
      const tail = s.slice(1) // ".example.com"
      if (!a.endsWith(tail)) return false
      const head = a.slice(0, a.length - tail.length)
      return head.length > 0 && !head.includes('.')
    })
  }

  for (const address of ['github.com', 'www.github.com', 'evil.example', 'github.com.evil.example', 'not a hostname!']) {
    test(`the page's name verdict agrees with an independent match of "${address}"`, async ({ page }) => {
      await bootExplore(page)
      await page.locator('#address-input').fill(address)

      const sansText = await evidence(page, '[data-verdict="promise-name"]', 'Certificate is for')
      const sans = sansText.split(',').map((s) => s.trim()).filter((s) => s !== '' && s !== '(no names)')
      const expected = matchesIndependently(address, sans)

      // The page's own answer, read as a state rather than inferred.
      await expect(page.locator('[data-verdict="promise-name"]'))
        .toHaveAttribute('data-result', expected ? 'pass' : 'fail')
    })
  }

  test('a failing name check names the actual cause', async ({ page }) => {
    await bootExplore(page)
    await page.locator('#address-input').fill('evil.example')
    await expectVerdict(page, 'promise-name', {
      contains: ['evil.example', 'A browser would refuse to go on'],
      result: 'fail',
    })
  })
})

test.describe('promise 4, expiry, re-derived from the dates on screen', () => {
  test('the time verdict agrees with an independent date comparison', async ({ page }) => {
    await bootExplore(page)
    for (const date of ['2026-10-04', '2026-11-29', '2026-11-30', '2027-06-01', '2026-01-15']) {
      await page.locator('#date-input').fill(date)
      const until = await evidence(page, '[data-verdict="promise-time"]', 'Valid until')
      const from = await evidence(page, '[data-verdict="promise-time"]', 'Valid from')
      // Re-derive from the printed human dates, by a different route than the
      // source takes (which compares the parsed certificate directly).
      const at = Date.parse(`${date}T00:00:00Z`)
      const expected = at >= Date.parse(`${from} UTC`) && at <= Date.parse(`${until} UTC`)
      await expect(
        page.locator('[data-verdict="promise-time"]'),
        `checking ${date} against ${from} .. ${until}`,
      ).toHaveAttribute('data-result', expected ? 'pass' : 'fail')
    }
  })

  test('an expired certificate says so, with the signatures still good', async ({ page }) => {
    await bootExplore(page)
    await page.locator('#date-input').fill('2027-06-01')
    await expectVerdict(page, 'promise-time', {
      contains: 'the only thing that changed is the date',
      result: 'fail',
    })
    // The claim that nothing cryptographic changed, asserted against the links.
    await expect(page.locator('#chain .walk-link[data-result="fail"]')).toHaveCount(0)
  })
})

test.describe('promise 3, vouching', () => {
  test('one flipped bit turns the vouching verdict red and names why', async ({ page }) => {
    await bootExplore(page)
    await page.locator('#tamper-btn').click()
    await expectVerdict(page, 'promise-vouched', {
      contains: 'Nobody in the trusted list vouched for it',
      result: 'fail',
    })
    await expectVerdict(page, 'link-0', {
      contains: 'does not check out',
      result: 'fail',
    })
  })

  test('the root is reported as coming from the device, not the server', async ({ page }) => {
    await boot(page)
    // NOT "your device": this lab ships its own copy of a trust list and can
    // neither read nor change the reader's. The lesson survives the correction;
    // the overclaim does not.
    expect(await evidence(page, '[data-verdict="promise-vouched"]', 'Root came from'))
      .toBe("this lab's trusted list")
    // The box the page drew for it agrees.
    await expect(page.locator('#chain .walk-step[data-from-store="true"]')).toHaveCount(1)
    await expectClaim(page, 'anchor-source', {
      contains: 'operating system or browser vendor',
    })
  })

  test('a self-signed leaf is rejected and the page says it signed itself', async ({ page }) => {
    await bootExplore(page)
    await page.locator('#site-self-signed').check()
    await expectVerdict(page, 'promise-vouched', {
      contains: 'signed itself',
      result: 'fail',
    })
  })
})

/**
 * 4.1d -- THE NEGATIVE CLAIM.
 *
 * The claim: "A valid certificate does not establish who operates the name it
 * was issued for."
 *
 * The evidence fixture is the attacker chain: a reachable state in which every
 * check the page performs reports success AND the named property is violated
 * anyway. The three required assertions follow.
 */
test.describe('the negative claim: a valid certificate does not establish the operator', () => {
  test('1. the fixture is reachable through the UI', async ({ page }) => {
    await bootExplore(page)
    await page.locator('#site-attacker-name').check()
    await expect(page.locator('#site-attacker-name')).toBeChecked()
    await expect(page.locator('#address-input')).toHaveValue('login.yourbank-security.example')
  })

  test('2. every verdict the page renders in that state reports success', async ({ page }) => {
    await bootExplore(page)
    await page.locator('#site-attacker-name').check()

    // Asserted against the RENDERED verdicts, not a flag the test sets. If any
    // promise failed here the fixture would be demonstrating the mechanism
    // working rather than its limit.
    const promises = page.locator('#promises .summary-row')
    await expect(promises).toHaveCount(4)
    await expect(page.locator('#promises .summary-row[data-result="pass"]')).toHaveCount(4)
    // Every signature in the walk verified too.
    const links = await page.locator('#chain .walk-link').count()
    expect(links).toBeGreaterThan(0)
    await expect(page.locator('#chain .walk-link[data-result="pass"]')).toHaveCount(links)
    // And the padlock does show -- it is a real, correct, valid certificate.
    await expectVerdict(page, 'padlock', {
      contains: 'PADLOCK SHOWN',
      result: 'alarm',
    })
  })

  test('3. the limitation is on screen in that state, as the lab\'s own check', async ({ page }) => {
    await bootExplore(page)
    await page.locator('#site-attacker-name').check()

    // The lab's own check returns "not established" -- not a failure code,
    // because X.509 has none for this and inventing one would teach the
    // opposite of the lesson.
    await expectVerdict(page, 'nonpromise-operator', {
      contains: 'NOT ESTABLISHED',
      result: 'not-established',
    })
    expect(await evidence(page, '[data-verdict="nonpromise-operator"]', 'Operator identity'))
      .toBe('not established')

    // Visible, not in the README and not behind a disclosure.
    await expectClaim(page, 'negative-claim', {
      contains: 'does not establish who operates the name',
    })
    const claim = page.locator('[data-claim="negative-claim"]')
    await expect(claim).toBeVisible()
    expect(await claim.evaluate((el) => el.closest('details') === null)).toBe(true)
  })

  test('the claim holds on the real chain too, where nothing is wrong at all', async ({ page }) => {
    await boot(page)
    await expect(page.locator('#promises .summary-row[data-result="pass"]')).toHaveCount(4)
    await expectVerdict(page, 'nonpromise-operator', {
      contains: 'domain validation',
      result: 'not-established',
    })
    expect(await evidence(page, '[data-verdict="nonpromise-operator"]', 'Organization in certificate'))
      .toContain('none')
  })
})

test.describe('the other three non-promises are shown, not asserted', () => {
  test('honesty is not established, and says so with every check passing', async ({ page }) => {
    await bootExplore(page)
    await page.locator('#site-attacker-name').check()
    await expectVerdict(page, 'nonpromise-honest', {
      contains: 'there is no field for it',
      result: 'not-established',
    })
    expect(await evidence(page, '[data-verdict="nonpromise-honest"]', 'All checks passed')).toBe('yes')
  })

  test('the hostname is readable in the bytes the page printed', async ({ page }) => {
    await bootExplore(page)
    await expectVerdict(page, 'nonpromise-sni', {
      contains: 'readable at byte',
      result: 'not-established',
    })

    // INDEPENDENT RE-DERIVATION. Read the hex off the page, decode the run at
    // the offset the page claims, and confirm the hostname is really there.
    // Nothing here recomputes the encoder's own span arithmetic.
    const offsetText = await read(page, '[data-claim="sni-offset"]')
    const offset = Number(/starts at byte (\d+)/.exec(offsetText)?.[1])
    expect(Number.isInteger(offset)).toBe(true)

    const hexText = await read(page, '#wire .bytes')
    const bytes = hexText.split(/\s+/).filter((t) => /^[0-9a-f]{2}$/.test(t)).map((t) => parseInt(t, 16))
    const address = await page.locator('#address-input').inputValue()
    const decoded = String.fromCharCode(...bytes.slice(offset, offset + address.length))
    expect(decoded).toBe(address)

    // Where the name REALLY is, found by searching the printed bytes rather
    // than by trusting the offset the page stated. This is what makes the
    // offset claim below a measurement: if the encoder's declared span moves
    // while the bytes do not, trueOffset stays put and the claim stops
    // matching it.
    const trueOffset = String.fromCharCode(...bytes).indexOf(address)
    expect(trueOffset).toBeGreaterThan(0)
    expect(offset).toBe(trueOffset)
    await expectClaim(page, 'sni-offset', {
      contains: `starts at byte ${trueOffset} of ${bytes.length}`,
    })

    // And the page's own read-back agrees with the decode.
    await expectClaim(page, 'sni-readable', { contains: address })
  })

  test('the cipher list is unauthenticated NOW and checked later, both stated', async ({ page }) => {
    await bootExplore(page)
    await expectVerdict(page, 'nonpromise-strength', {
      contains: 'nobody has authenticated yet',
      result: 'not-established',
    })
    expect(await evidence(page, '[data-verdict="nonpromise-strength"]', 'Authenticated at this moment'))
      .toContain('no')
    // The correction that matters: TLS 1.3 DOES check afterwards that the
    // negotiation was not altered. Saying only "unauthenticated" taught a
    // beginner that downgrades are free, which is false -- RFC 8446 signs the
    // handshake transcript. The honest limitation is narrower: a padlock does
    // not tell you WHICH option was chosen.
    expect(await evidence(page, '[data-verdict="nonpromise-strength"]', 'Checked later in the handshake'))
      .toContain('yes')
    expect(await evidence(page, '[data-verdict="nonpromise-strength"]', 'Which one was chosen'))
      .toContain('not shown')
  })
})

test.describe('the page never contradicts itself', () => {
  /**
   * One value, used everywhere.
   *
   * This failed before it was fixed: with the checking date moved past expiry
   * the headline read NO PADLOCK while the honesty card a few hundred pixels
   * below still said "Every check above passed" and reported
   * "All checks passed: yes". `checkHonest` was reading only the path and name
   * results and ignoring expiry and the key.
   *
   * Nothing in the suite caught it, because the honesty row was only ever
   * asserted in the attacker state -- where every check really does pass. A
   * page that contradicts itself teaches whichever half the reader read, so
   * this sweeps every breakage instead of sampling one.
   */
  const BREAKAGES = [
    { name: 'expired', apply: async (page: Page) => page.locator('#date-input').fill('2026-11-30') },
    { name: 'not yet valid', apply: async (page: Page) => page.locator('#date-input').fill('2026-01-15') },
    { name: 'name mismatch', apply: async (page: Page) => page.locator('#address-input').fill('evil.example') },
    { name: 'malformed address', apply: async (page: Page) => page.locator('#address-input').fill('not a host!') },
    { name: 'signature tampered', apply: async (page: Page) => page.locator('#tamper-btn').click() },
    { name: 'self-signed chain', apply: async (page: Page) => page.locator('#site-self-signed').check() },
  ] as const

  for (const breakage of BREAKAGES) {
    test(`no passing-everything sentence survives: ${breakage.name}`, async ({ page }) => {
      // Explore mode: the sweep needs every control at once, and the property
      // under test is about the page's consistency rather than the lesson.
      await bootExplore(page)
      await breakage.apply(page)

      // At least one promise must now be failing, or the breakage did nothing
      // and this test would pass by vacuity.
      await expect(page.locator('#promises .summary-row[data-result="fail"]').first()).toBeVisible()
      const failing = await page.locator('#promises .summary-row[data-result="fail"]').count()
      expect(failing, `${breakage.name} must actually break something`).toBeGreaterThan(0)

      // The padlock agrees.
      await expect(page.locator('[data-verdict="padlock"]')).toHaveAttribute('data-result', 'fail')

      // And NOTHING anywhere says everything passed.
      expect(await evidence(page, '[data-verdict="nonpromise-honest"]', 'All checks passed'))
        .toBe('no')
      const honesty = await read(page, '[data-verdict="nonpromise-honest"]')
      expect(honesty).not.toContain('Every check above passed')

      // The honesty verdict itself is unchanged by any of this: it was never
      // contingent on the checks passing, and must not become so. Asserted
      // through expectVerdict so a mutation that re-introduces the
      // every-check-passed bug has something named to kill.
      await expectVerdict(page, 'nonpromise-honest', {
        contains: 'whether the checks pass or fail',
        result: 'not-established',
      })
    })
  }

  test('with nothing broken, the passing sentence IS shown', async ({ page }) => {
    // The other side of the ratchet: a guard that only ever reports "no" would
    // pass every test above while saying nothing true.
    await bootExplore(page)
    await page.locator('#site-attacker-name').check()
    expect(await evidence(page, '[data-verdict="nonpromise-honest"]', 'All checks passed'))
      .toBe('yes')
    await expectVerdict(page, 'nonpromise-honest', {
      contains: 'Every check above passed',
      result: 'not-established',
    })
  })
})

test.describe('what the reader types is treated as an address', () => {
  test('a pasted URL matches, and only its host reaches the first message', async ({ page }) => {
    await bootExplore(page)
    await page.locator('#address-input').fill('https://github.com/owner/repo?tab=readme')
    // A browser extracts the host and matches THAT. Treating the whole URL as a
    // hostname failed the name check and told the reader a browser would
    // refuse -- wrong, and the opposite of the lesson.
    await expect(page.locator('[data-verdict="promise-name"]')).toHaveAttribute('data-result', 'pass')
    // And the URL must not end up in the SNI exhibit, which would be showing a
    // first message no browser would ever send.
    const sni = await read(page, '[data-claim="sni-readable"]')
    expect(sni).toContain('github.com')
    expect(sni).not.toContain('https://')
    expect(sni).not.toContain('/owner/repo')
  })
})

test.describe('the page keeps its own copy honest', () => {
  test('the intro leads with plain language and no hex above it', async ({ page }) => {
    await boot(page)
    await expectClaim(page, 'negative-claim', {
      contains: 'does not establish who operates the name',
    })
    // A Beginner lab requirement from the brief: the plain-language intro comes
    // before anything numeric. Asserted structurally -- the intro section is
    // the first child of <main>, and no hex run appears inside it.
    const firstSection = await page.locator('main > section').first().getAttribute('id')
    expect(firstSection).toBe('intro')
    const introText = await read(page, '#intro')
    expect(introText).not.toMatch(/[0-9a-f]{2}( [0-9a-f]{2}){3}/)
  })

  test('changing an input fully replaces the verdict, leaving nothing stale', async ({ page }) => {
    await bootExplore(page)
    // On a PASS the detail sits behind the row's disclosure; read the whole
    // marker so the assertion is about what the page holds, not about which
    // side of a disclosure it is on.
    const before = await read(page, '[data-verdict="promise-name"]')
    expect(before).toContain('exactly the address you asked for')

    await page.locator('#address-input').fill('evil.example')
    const after = await read(page, '[data-verdict="promise-name"]')
    // The old sentence is GONE, not merely joined by a new one.
    expect(after).not.toContain('exactly the address you asked for')
    expect(after).toContain('evil.example')
    await expect(page.locator('[data-verdict="promise-name"]')).toHaveCount(1)
  })

  test('re-selecting the SAME site does not disturb a fresh verdict', async ({ page }) => {
    await bootExplore(page)
    const before = await read(page, '[data-verdict="padlock"]')
    // The no-op guard 4.1b asks for: a no-change change must not retire
    // anything.
    await page.locator('#site-github-real').check()
    await expect(page.locator('[data-verdict="padlock"]')).toHaveAttribute('data-result', 'pass')
    expect(await read(page, '[data-verdict="padlock"]')).toBe(before)
  })

  test('nothing is hidden-but-painted, and no [hidden] cascade trap exists', async ({ page }) => {
    await boot(page)
    // The 4.1 probe. The lab DOES use [hidden], legitimately: a closed
    // definition panel is hidden that way, which is the correct semantics and
    // what `aria-expanded` on its button is describing. So the rule is not
    // "no [hidden]" -- it is that nothing hidden may still PAINT, which is the
    // cascade trap: a class rule setting `display` outranks the UA [hidden]
    // rule, so the element renders while the code believes it is hidden.
    const painted = await page.evaluate(() =>
      [...document.querySelectorAll('[hidden]')].filter((el) =>
        (el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true }),
      ).length,
    )
    expect(painted, 'a [hidden] element that still paints is the cascade trap').toBe(0)

    // A shut <details> really hides its body.
    const bodyVisible = await page.locator('#chain details .evidence').first().isVisible()
    expect(bodyVisible).toBe(false)
  })
})

/**
 * The guided journey.
 *
 * The lesson is the default, so these run from the arrival state without
 * switching anything. Every assertion is about what the page COMPUTED -- which
 * step it is on, whether a prediction was right, what actually changed -- and
 * never about a sentence the lesson happens to carry, except where that
 * sentence is itself the claim.
 */
test.describe('the five-step lesson', () => {
  test('arrives on step 1 of 5 with the real chain and every check passing', async ({ page }) => {
    // Plain boot, deliberately: that the GUIDED LESSON is the arrival state is
    // the single most important structural fact about this page, and switching
    // to explore mode here would assert the opposite of the point.
    await boot(page)
    await expectClaim(page, 'step-progress', { text: 'Step 1 of 5.' })
    await expect(page.locator('#site-github-real')).toBeChecked()
    await expect(page.locator('#promises .summary-row[data-result="pass"]')).toHaveCount(4)
  })

  test('each check leads with a plain state, not a paragraph', async ({ page }) => {
    await boot(page)
    // The beginner-facing half of the progressive-disclosure rule: the short
    // state is what is read first, and it is a real computed label rather than
    // a restatement of the outcome word.
    expect(await page.locator('#promises .summary-state').allTextContents())
      .toEqual(['Key loads', 'Matches', 'Signature verifies', 'In date'])
  })

  test('a failing check shows its cause WITHOUT being asked to', async ({ page }) => {
    await boot(page)
    await page.locator('#step-next').click()
    await page.locator('#address-input').fill('evil.example')
    // The cause is in the row itself, not behind the row's disclosure. "Why
    // did this just break" is the one question that is never optional reading.
    const cause = page.locator('[data-verdict="promise-name"] .summary-cause')
    await expect(cause).toBeVisible()
    await expect(cause).toContainText('evil.example')
    // And it is genuinely outside the disclosure.
    expect(await cause.evaluate((el) => el.closest('details') === null)).toBe(true)
  })

  test('the causal summary names what changed AND what did not', async ({ page }) => {
    await boot(page)
    await page.locator('#step-next').click()
    await page.locator('#address-input').fill('evil.example')
    // Computed by diffing the previous outcomes against the new ones, so it
    // cannot drift from what the checks did.
    await expectClaim(page, 'changed', {
      contains: ['Changed: the address', 'The name now fails', 'still check out'],
    })
  })

  test('the expiry step shows the dates failing and the signatures holding', async ({ page }) => {
    await boot(page)
    for (let i = 0; i < 2; i += 1) await page.locator('#step-next').click()
    await expectClaim(page, 'step-progress', { text: 'Step 3 of 5.' })
    // A one-click preset, derived from the certificate's own notAfter.
    await page.locator('#preset-expired').click()
    await expect(page.locator('[data-verdict="promise-time"]')).toHaveAttribute('data-result', 'fail')
    await expectClaim(page, 'changed', {
      contains: ['Changed: the checking date', 'The dates now fail'],
    })
    // The lesson's whole point, asserted on the chain rather than the prose.
    await expect(page.locator('#chain .walk-link[data-result="fail"]')).toHaveCount(0)
  })

  test('a prediction is scored against the option the reader picked', async ({ page }) => {
    await boot(page)
    await page.locator('#step-next').click()
    await page.locator('#predict-name-must-match-no-padlock').check()
    await expectVerdict(page, 'prediction', { contains: 'predicted correctly', result: 'pass' })
    await page.locator('#predict-name-must-match-still-padlock').check()
    await expectVerdict(page, 'prediction', { contains: 'Not what happens', result: 'fail' })
  })

  test('every step resets to its own baseline, inheriting nothing', async ({ page }) => {
    await boot(page)
    // Break something on step 1, then move on.
    await page.locator('#step-next').click()
    await page.locator('#address-input').fill('evil.example')
    await expect(page.locator('[data-verdict="promise-name"]')).toHaveAttribute('data-result', 'fail')
    await page.locator('#step-next').click()
    // Step 3 must not inherit step 2's broken address.
    await expect(page.locator('[data-verdict="promise-name"]')).toHaveAttribute('data-result', 'pass')
    await expect(page.locator('[data-verdict="padlock"]')).toHaveAttribute('data-result', 'pass')
  })

  test('the lookalike step cannot inherit a tampered signature', async ({ page }) => {
    await boot(page)
    // Tamper in explore mode, then pick the lookalike directly: its caption
    // promises every check passes, and carrying the tamper across made that a
    // lie about the state the reader was actually in.
    await page.locator('#mode-explore').click()
    await page.locator('#tamper-btn').click()
    await expect(page.locator('#tamper-btn')).toHaveAttribute('aria-pressed', 'true')
    await page.locator('#site-attacker-name').check()
    await expect(page.locator('#tamper-btn')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('#promises .summary-row[data-result="pass"]')).toHaveCount(4)
    await expectVerdict(page, 'padlock', { contains: 'PADLOCK SHOWN', result: 'alarm' })
  })

  test('state badges say what the reader has left switched on', async ({ page }) => {
    await boot(page)
    await expect(page.locator('.badge')).toHaveText(['NOTHING CHANGED YET'])
    await page.locator('#mode-explore').click()
    await page.locator('#tamper-btn').click()
    await expect(page.locator('.badge').filter({ hasText: 'SIGNATURE ALTERED' })).toHaveCount(1)
  })
})

test.describe('the closing check', () => {
  const finish = async (page: Page): Promise<void> => {
    await boot(page)
    for (let i = 0; i < 5; i += 1) await page.locator('#step-next').click()
  }

  test('three questions appear only after the lesson is finished', async ({ page }) => {
    await boot(page)
    await expect(page.locator('input[name^="quiz-"]')).toHaveCount(0)
    await finish(page)
    await expect(page.locator('input[name^="quiz-"]')).toHaveCount(9)
    await expectClaim(page, 'quiz-progress', { text: '0 of 3 answered, 0 right.' })
  })

  test('a wrong answer is explained and offers the experiment again', async ({ page }) => {
    await finish(page)
    await page.locator('#quiz-lookalike-yes').check()
    await expectVerdict(page, 'quiz-lookalike', { contains: 'Not quite', result: 'fail' })
    // The explanation, not just a mark.
    await expect(page.locator('#quiz-lookalike-yes').locator('xpath=ancestor::label'))
      .toContainText('Nobody validated who the name belongs to')
    // And a route back to the experiment that settles it.
    await expect(page.locator('#revisit-lookalike')).toBeVisible()
    await page.locator('#revisit-lookalike').click()
    await expectClaim(page, 'step-progress', { text: 'Step 5 of 5.' })
  })

  test('a right answer is scored right, and the count is computed', async ({ page }) => {
    await finish(page)
    await page.locator('#quiz-expiry-no').check()
    await expectVerdict(page, 'quiz-expiry', { contains: 'That is right', result: 'pass' })
    await expectClaim(page, 'quiz-progress', { text: '1 of 3 answered, 1 right.' })
    await page.locator('#quiz-suffix-no').check()
    await expectVerdict(page, 'quiz-suffix', { contains: 'That is right', result: 'pass' })
    await expectClaim(page, 'quiz-progress', { text: '2 of 3 answered, 2 right.' })
  })

  test('nothing is unlocked or awarded for clicking through', async ({ page }) => {
    await finish(page)
    for (const id of ['#quiz-lookalike-yes', '#quiz-expiry-yes', '#quiz-suffix-yes']) {
      await page.locator(id).check()
    }
    await expectClaim(page, 'quiz-progress', { text: '3 of 3 answered, 0 right.' })
    // No badge, no certificate, no "complete".
    const quiz = (await page.locator('#quiz').textContent()) ?? ''
    expect(quiz).not.toMatch(/complete|congratulations|well done|badge|certificate of/i)
  })
})

test.describe('the reader keeps their place', () => {
  test('focus stays on the control that was activated', async ({ page }) => {
    await boot(page)
    await page.locator('#mode-explore').click()
    for (const id of ['tamper-btn', 'reset-btn', 'tamper-btn']) {
      await page.locator(`#${id}`).focus()
      await page.locator(`#${id}`).click()
      // Every action replaces the controls, so without restoration a keyboard
      // reader lost their place on every single interaction.
      expect(await page.evaluate(() => document.activeElement?.id ?? ''), `after ${id}`).toBe(id)
    }
  })

  test('focus survives a scenario change', async ({ page }) => {
    await boot(page)
    await page.locator('#mode-explore').click()
    await page.locator('#site-self-signed').focus()
    await page.locator('#site-self-signed').check()
    expect(await page.evaluate(() => document.activeElement?.id ?? '')).toBe('site-self-signed')
  })

  test('an open disclosure survives an edit, and the caret keeps its place', async ({ page }) => {
    await boot(page)
    await page.locator('#mode-explore').click()
    await page.locator('details[data-disclosure="chain"] > summary').click()
    await expect(page.locator('details[data-disclosure="chain"]')).toHaveJSProperty('open', true)

    await page.locator('#address-input').click()
    await page.locator('#address-input').fill('github.co')
    // Opening the certificate detail and then editing the address used to close
    // it again, on every keystroke.
    await expect(page.locator('details[data-disclosure="chain"]')).toHaveJSProperty('open', true)
    expect(await page.evaluate(() => document.activeElement?.id ?? '')).toBe('address-input')
  })

  test('definitions open by keyboard, not by hover', async ({ page }) => {
    await boot(page)
    const btn = page.locator('#intro .define').first()
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    // A hover tooltip is unreachable by keyboard and by touch; this is a real
    // button, so Enter works.
    await btn.focus()
    await page.keyboard.press('Enter')
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    const panelId = await btn.getAttribute('aria-controls')
    await expect(page.locator(`#${panelId}`)).toBeVisible()
  })
})

test.describe('a pasted URL and other input work the reader should not have to do', () => {
  test('date presets come from the certificate, not from a hardcoded list', async ({ page }) => {
    await boot(page)
    await page.locator('#mode-explore').click()
    // The real leaf expires 2026-11-29, so the "day after expiry" preset must
    // be 2026-11-30 for THIS certificate.
    await page.locator('#preset-expired').click()
    await expect(page.locator('#date-input')).toHaveValue('2026-11-30')
    await expect(page.locator('[data-verdict="promise-time"]')).toHaveAttribute('data-result', 'fail')

    // Switch to the toy chain, whose window is 2026-01-01 to 2036-01-01: the
    // same button must now mean a different date.
    await page.locator('#site-attacker-name').check()
    await page.locator('#preset-expired').click()
    await expect(page.locator('#date-input')).not.toHaveValue('2026-11-30')
  })

  test('hints and errors are tied to their inputs', async ({ page }) => {
    await boot(page)
    await page.locator('#mode-explore').click()
    for (const id of ['address-input', 'date-input', 'tamper-btn']) {
      const described = await page.locator(`#${id}`).getAttribute('aria-describedby')
      expect(described, `${id} must describe its own hint`).toBeTruthy()
      for (const ref of (described ?? '').split(/\s+/)) {
        await expect(page.locator(`#${ref}`), `${id} -> #${ref}`).toHaveCount(1)
      }
    }
  })
})
