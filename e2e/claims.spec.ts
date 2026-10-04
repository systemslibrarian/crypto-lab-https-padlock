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
    await expect(page.locator('#promises .check[data-result="pass"]')).toHaveCount(4)
    await expect(page.locator('#promises .check[data-result="fail"]')).toHaveCount(0)
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
    await boot(page)
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
      await boot(page)
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
    await boot(page)
    await page.locator('#address-input').fill('evil.example')
    await expectVerdict(page, 'promise-name', {
      contains: ['evil.example', 'A browser would refuse to go on'],
      result: 'fail',
    })
  })
})

test.describe('promise 4, expiry, re-derived from the dates on screen', () => {
  test('the time verdict agrees with an independent date comparison', async ({ page }) => {
    await boot(page)
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
    await boot(page)
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
    await boot(page)
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
    await boot(page)
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
    await boot(page)
    await page.locator('#site-attacker-name').check()
    await expect(page.locator('#site-attacker-name')).toBeChecked()
    await expect(page.locator('#address-input')).toHaveValue('login.yourbank-security.example')
  })

  test('2. every verdict the page renders in that state reports success', async ({ page }) => {
    await boot(page)
    await page.locator('#site-attacker-name').check()

    // Asserted against the RENDERED verdicts, not a flag the test sets. If any
    // promise failed here the fixture would be demonstrating the mechanism
    // working rather than its limit.
    const promises = page.locator('#promises .check')
    await expect(promises).toHaveCount(4)
    await expect(page.locator('#promises .check[data-result="pass"]')).toHaveCount(4)
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
    await boot(page)
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
    await expect(page.locator('#promises .check[data-result="pass"]')).toHaveCount(4)
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
    await boot(page)
    await page.locator('#site-attacker-name').check()
    await expectVerdict(page, 'nonpromise-honest', {
      contains: 'there is no field for it',
      result: 'not-established',
    })
    expect(await evidence(page, '[data-verdict="nonpromise-honest"]', 'All checks passed')).toBe('yes')
  })

  test('the hostname is readable in the bytes the page printed', async ({ page }) => {
    await boot(page)
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
    await boot(page)
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
      await boot(page)
      await breakage.apply(page)

      // At least one promise must now be failing, or the breakage did nothing
      // and this test would pass by vacuity.
      await expect(page.locator('#promises .check[data-result="fail"]').first()).toBeVisible()
      const failing = await page.locator('#promises .check[data-result="fail"]').count()
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
    await boot(page)
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
    await boot(page)
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
    await boot(page)
    const before = await read(page, '[data-verdict="promise-name"] .check-detail')
    expect(before).toContain('exactly the address you asked for')

    await page.locator('#address-input').fill('evil.example')
    const after = await read(page, '[data-verdict="promise-name"] .check-detail')
    // The old sentence is GONE, not merely joined by a new one.
    expect(after).not.toContain('exactly the address you asked for')
    expect(after).toContain('evil.example')
    await expect(page.locator('[data-verdict="promise-name"]')).toHaveCount(1)
  })

  test('re-selecting the SAME site does not disturb a fresh verdict', async ({ page }) => {
    await boot(page)
    const before = await read(page, '[data-verdict="padlock"]')
    // The no-op guard 4.1b asks for: a no-change change must not retire
    // anything.
    await page.locator('#site-github-real').check()
    await expect(page.locator('[data-verdict="padlock"]')).toHaveAttribute('data-result', 'pass')
    expect(await read(page, '[data-verdict="padlock"]')).toBe(before)
  })

  test('nothing is hidden-but-painted, and no [hidden] cascade trap exists', async ({ page }) => {
    await boot(page)
    // The 4.1 probe, adapted: this lab ships no [hidden] at all, so the trap
    // to catch is a class rule setting `display` that outranks the UA [hidden]
    // rule. Assert both halves rather than the absence alone.
    await expect(page.locator('[hidden]')).toHaveCount(0)
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
