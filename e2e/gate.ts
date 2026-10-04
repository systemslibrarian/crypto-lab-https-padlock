import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * The two phone widths the gate drives, for the WCAG 1.4.10 reflow half.
 *
 * 390 is a current iPhone's CSS width and the one most readers will arrive at.
 * 320 is the narrowest width 1.4.10 is written against, and it is the one that
 * actually bites: the shared top bar's touch rule stops widening its buttons
 * below 380 precisely so a 2.5.5 gain is not traded for a reflow failure, and
 * this lab's own `.evidence-row` and `.check` grids collapse to one column at
 * 640. Driving 390 alone would leave the floor untested.
 */
export const NARROW = { width: 390, height: 844 };
export const FLOOR = { width: 320, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old spec pushed
 *     `animation:none!important; transition:none!important` through
 *     `addStyleTag`. That BYPASSES this lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it,
 *     so the one rendering a reduced-motion reader actually gets — every
 *     `.check`, `.walk-step` and `.walk-link` with its `settle` animation
 *     collapsed to 0.001ms by the stylesheet's own rule — was never once the
 *     rendering that got scanned. This gate sets the
 *     preference through `emulateMedia`, asserts from inside the page that it
 *     took effect (`test.use({ reducedMotion })` silently does nothing on
 *     Playwright 1.61.1), and injects nothing.
 *
 *  2. IT FORCED EVERY DISCLOSURE OPEN FROM SCRIPT. The old drive stripped every
 *     `[hidden]` attribute and set every `<details>.open` by JS before its only
 *     scan, so the SHUT state — which is what every reader arrives at — was
 *     never scanned at all. This lab renders every section eagerly and hides
 *     nothing behind a tab, so there is no `[hidden]` here to strip; what it
 *     does ship is two `<details>` that arrive closed, and this gate opens each
 *     through its `<summary>`, which is the route a reader has, and scans
 *     before and after.
 *
 *  3. IT DROVE BLIND AND THEN THREW THE STATES AWAY. The old drive clicked
 *     every button whose label matched a regex, swallowed every failure with
 *     `.catch(() => {})`, waited a fixed timeout, and scanned ONCE at the end —
 *     so every failure rendering was overwritten before anything measured it,
 *     and a click that silently did nothing looked identical to one that
 *     worked. This drive names every control it touches, asserts a real DOM
 *     completion signal after each, and scans after every step. The states
 *     that matter here are the FAILURES — a mismatched address, an expired
 *     date, a tampered signature, a self-signed chain — and the ALARM, none of
 *     which is reachable without deliberately breaking something. Dark is the
 *     only theme, so the matrix is {1280, 390, 320} rather than a theme cross.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The surfaces that carry
 *     this lab's meaning — the `.padlock` verdict in all three of its states,
 *     all eight `.check` rows, the device-held `.walk-step`, both `.callout`
 *     tones, the `.bytes-hl` hostname highlight and the shared top bar's ink —
 *     are all `color-mix()` washes axe files under `incomplete` rather than
 *     judging. So is an `aria-label` on a role-less element.
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR GENERATED-CONTENT ORACLE. The old
 *     spec hand-rolled one luminance check over two input selectors, reading
 *     the DECLARED `border-top-color` and `background-color` — blind to
 *     `color-mix()`, to composited backdrops, to every `.btn`, `.site-opt`
 *     radio row and date input, and to all states past first paint.
 *     `nontext.ts` replaces it with a measured oracle over every control at
 *     every driven state, and `expectNoHorizontalOverflow` adds the 1.4.10
 *     check axe has no rule for.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `style.css`'s reduced-motion
 * block cancels `.panel` / `.reveal` animations and every transition, so
 * `getAnimations()` is normally empty and this returns on the sixth frame. It
 * stays because the shared top bar's `.cl-btn` transitions are declared
 * OUTSIDE the lab's `@media` block — `* { transition: none !important }` wins
 * today, but that is a property of the current stylesheet, not of the page.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      // `| undefined` on both, not just `?`: under exactOptionalPropertyTypes
      // an optional property cannot be ASSIGNED undefined, and `done()`
      // clears __settleStart that way.
      const w = window as unknown as {
        __quietFrames?: number | undefined;
        __settleStart?: number | undefined;
      };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab
 * has that shape in miniature: `@keyframes settle` starts
 * `from { opacity: .35 }` and every `.check`, `.walk-step` and `.walk-link`
 * rides it. The start opacity is deliberately NOT 0 and the reduced-motion
 * block collapses the duration rather than cancelling the animation, so the
 * end state is reached either way — correct today, and this assertion is what
 * makes that a measurement rather than a reading.
 *
 * `aria-hidden` subtrees are excluded; what this lab hides is the bracket
 * glyphs beside their own words — see `contrast.ts`.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created.
 *
 * This lab renders every section eagerly from one async `refresh()`, and that
 * is precisely why this matters: a throw inside `assess()` -- a parse failure,
 * a WebCrypto rejection -- leaves the mount points it had not reached yet
 * EMPTY, and an empty region is exactly what a scan reports as perfectly
 * accessible. `boot()` below asserts each section has content for that reason;
 * this catches the throw itself. Attach before `boot`, assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * The shared `.cl-topbar` carries an explicit `role="banner"`. This lab's hero
 * is a `<div class="cl-hero">`, not a `<header>`, so nothing here implies a
 * second banner today — but the master template's own hero sample in section
 * 3.1 is written as `<header class="cl-hero">`, so the single most likely edit
 * to this page is one that introduces a second banner. The shared bar's
 * `dedupeBanner()` would demote it; asserting the OUTCOME rather than the
 * markup is what catches the case where it does not.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * List semantics survive their styling.
 *
 * This lab is built out of lists: the site chooser, both check lists, the
 * chain walk, every `.evidence` block, the two scope lists and the next-steps
 * list. All of them are styled `list-style: none`, which is exactly the
 * declaration that makes Safari and VoiceOver DROP a list's implicit role, so
 * `src/ui/dom.ts`'s `list()` helper states `role="list"` and stamps
 * `role="listitem"` on every child. Here, unlike most of this fleet, an
 * explicit role on a list is the fix rather than the defect. What is asserted
 * is the SHAPE of that fix: any explicit role on a `ul`/`ol` must be `list`
 * (any other value orphans every `<li>` under it), and a `role="list"` must
 * never sit on an empty element, because axe applies `aria-required-children`
 * to the explicit role. `list()` refuses to build an empty one for that
 * reason; this asserts the outcome in the rendered DOM rather than trusting
 * the helper.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els
      .filter((e) => e.getAttribute('role') !== 'list' || e.children.length === 0)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
      )
  );
  expect(
    broken,
    'an explicit non-list role on a list deletes its semantics; an empty role="list" fails aria-required-children'
  ).toEqual([]);
}


/**
 * Shared setup. Runs before EVERY test that imports it, so an assertion here
 * fails all of them at once, under whatever name those tests carry.
 *
 * SO THIS FUNCTION ASSERTS STRUCTURE AND NEVER PRODUCT COPY (master template
 * 4.1a). On 2026-09-26 crypto-lab-mceliece-gate changed one textarea's default
 * string; its gate.ts still asserted the old sentence, boot() threw, both axe
 * runs failed, the build job failed, the deploy was skipped, and deploy-sync
 * reported the lab stale. The step that went red was called "Accessibility
 * gate", and four of its six a11y tests had passed. For three days the live
 * site served security claims that main had already corrected, and the one red
 * thing in sight named the wrong subject.
 *
 * Structure: the control exists, the section has content, counts, a default
 * matching a SHAPE. Copy -- what a string SAYS -- belongs in
 * e2e/claims.spec.ts, where a failure names copy as the subject. Every
 * sentence on this page lives in src/ui/content.ts and is asserted there.
 *
 * Reduced motion is applied imperatively BEFORE navigation and then asserted
 * from inside the page: `test.use({ reducedMotion })` and the config key are
 * both measured no-ops on Playwright 1.61.x.
 */
export async function boot(page: Page): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);

  // Dark is the only theme, pinned by the head script and on <html> itself.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);

  // The shared skip link points at an id that exists. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run
  // says nothing about.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('#app')).toHaveCount(1);

  // Dark is the only theme, so the page must carry no theme control at all.
  // The shared CSS hides a lab-local toggle with `display:none !important`,
  // which would leave a dead-but-known element; asserting the count at zero
  // catches the day one is added without going through that list.
  await expect(
    page.locator('#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]')
  ).toHaveCount(0);
  await expect(page.locator('#cl-theme-toggle')).toHaveCount(0);

  // ── Every section rendered something ────────────────────────────────────
  // This lab renders eagerly from one async refresh(), so a throw inside
  // assess() leaves the sections it had not reached EMPTY — and an empty
  // region is exactly what a scan reports as perfectly accessible. Asserted
  // as a count of non-empty sections rather than by reading any of their text.
  // The CORE sections each carry their own h2. The depth sections (chain, wire,
  // scope) live inside #depth behind a disclosure each, so they carry an h3 and
  // #depth owns the h2 -- asserted separately below.
  for (const id of ['intro', 'stage', 'controls', 'padlock', 'promises', 'nonpromises', 'quiz', 'depth', 'next']) {
    await expect(page.locator(`#${id}`), `#${id} must not render empty`).not.toBeEmpty();
    await expect(page.locator(`#${id} h2`), `#${id} must have its heading`).toHaveCount(1);
  }
  for (const id of ['chain', 'wire', 'scope']) {
    await expect(page.locator(`#${id}`), `#${id} must not render empty`).not.toBeEmpty();
    await expect(
      page.locator(`#${id} > details > summary`),
      `#${id} is depth: it must sit behind exactly one disclosure`
    ).toHaveCount(1);
  }

  // ── The shipped defaults, as SHAPES ─────────────────────────────────────
  // The GUIDED LESSON is the arrival state, which is the single most important
  // structural fact about this page: a newcomer gets a step, not a control
  // panel. Step 1 shows the site chooser and nothing else, so the address,
  // date and tamper controls are deliberately ABSENT here -- asserted, because
  // their absence is the design rather than a render that failed.
  await expect(page.locator('#mode-lesson')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mode-explore')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.site-opt input[type="radio"]')).toHaveCount(3);
  await expect(page.locator('.site-opt input[type="radio"]:checked')).toHaveCount(1);
  await expect(page.locator('#address-input')).toHaveCount(0);
  await expect(page.locator('#date-input')).toHaveCount(0);
  await expect(page.locator('#tamper-btn')).toHaveCount(0);
  await expect(page.locator('#promises .summary-row')).toHaveCount(4);
  await expect(page.locator('#nonpromises .summary-row')).toHaveCount(4);
  // Five steps, one of them current.
  await expect(page.locator('.progress-step')).toHaveCount(5);
  await expect(page.locator('.progress-step[aria-current="step"]')).toHaveCount(1);
  // The quiz is not yet reachable, so it renders its placeholder rather than
  // nine radios.
  await expect(page.locator('input[name^="quiz-"]')).toHaveCount(0);

  // Every verdict marker the page renders carries a result. A marker with no
  // data-result is a verdict rendered with no state, which is the shape
  // e2e/expect-verdict.ts refuses and this catches at the source.
  const stateless = await page.locator('[data-verdict]:not([data-result])').count();
  expect(stateless, 'every [data-verdict] must carry a data-result').toBe(0);

  // ── Disclosures ship shut, and every one is keyed ───────────────────────
  // The key is what lets an open disclosure survive a re-render; one without a
  // key silently closes itself on the reader's next keystroke.
  await expect(page.locator('details[open]')).toHaveCount(0);
  const unkeyed = await page.locator('details:not([data-disclosure])').count();
  expect(unkeyed, 'every <details> needs a data-disclosure key to survive a re-render').toBe(0);
  // Inline definitions are buttons, never hover tooltips.
  await expect(page.locator('.define')).not.toHaveCount(0);
  await expect(page.locator('.define[aria-expanded="true"]')).toHaveCount(0);
  const unlabelled = await page.locator('.define:not([aria-controls])').count();
  expect(unlabelled, 'a definition toggle must point at its panel').toBe(0);

  await settle(page);
  await expectNotBlank(page, 'first paint');
}
/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab has
 * three shapes that put real pressure on it: the `.bytes` hex view, which is a
 * ~160-byte run and the one element deliberately given its own
 * `overflow-x: auto` scroller; the `.evidence-value` cells, which hold whole
 * X.509 subject strings and rely on `overflow-wrap: anywhere` rather than a
 * scroller; and the `.walk-name` certificate names, which are long enough to
 * blow out a grid column on their own. At 320px that is precisely what this
 * check exists to catch -- and because the scroller is legitimate, the
 * `clipped()` test below is what stops it being reported as the culprit.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab SHIPS one, so the assertion is live rather than vacuous: `.bytes`
 * carries `overflow-x: auto` because a hex run is the one thing on the page
 * that genuinely should not reflow -- byte boundaries carry meaning. It is
 * given `tabindex="0"`, `role="region"` and an `aria-label` in
 * `src/ui/render.ts` for exactly this reason. A scroller born without a
 * keyboard route is invisible to axe, which is why this is measured at every
 * driven state rather than asserted once.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden`
 * DO remove an element from the tab order, so those are skipped rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair.
 * Everything on this page is rendered and on screen, so the shape at risk here
 * is a closed `<details>`: Chromium hides a shut disclosure's body with
 * `content-visibility: hidden` rather than `display: none`, and anything
 * focusable inside it must not stay in the tab order.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: the shared skip link parks at `top:-3rem` with
 * full opacity and slides in on focus. The drive scans it focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run
 * with it set prints every finding as it happens and then fails at the end, so
 * a green collection run cannot be mistaken for a green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no
 * text node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide
 * this oracle had been called from inside a soft wrapper AFTER its
 * `if (!COLLECTING) return` guard — so in a strict run, which is every run in
 * CI and every run anyone reads as a pass, the guard returned first and
 * `nontext.ts` never executed at all. Thirteen repos certified themselves
 * clean on an oracle that had never looked. Calling it here means it runs at
 * every driven state, including `:hover`, and this repo's baseline was
 * captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the
 * point — or the drive stopped reaching the state that shows it, which is a
 * coverage regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Nine assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters here because the surfaces carrying
 *    this lab's meaning are `color-mix()` washes axe cannot resolve: the
 *    `.padlock` verdict, all eight `.check` rows, the device-held
 *    `.walk-step`, both `.callout` tones, the `.bytes-hl` hostname highlight,
 *    the hero aside and the shared bar's ink. Everything else in that bucket
 *    is a real result axe simply could not finish — including
 *    `aria-prohibited-attr`, which is where an `aria-label` on a role-less
 *    element hides. This page leans on getting that right: every `.evidence`,
 *    `.checks`, `.walk` and `.site-list` carries an `aria-label` alongside an
 *    explicit `role="list"`, and the `.bytes` scroller pairs its label with
 *    `role="region"`. Drop any of those roles and the label is silently
 *    discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - the same walk over `aria-hidden` content with the exemption lifted —
 *    SC 1.4.3 is about what a reader SEES; see `contrast.ts` for what this
 *    lab hides and why it is measured anyway.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of
  // axe-core 4.12's 105 rule definitions; the chained form executes 4.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: a sticky `<header role="banner">` above a
  // `<div id="app">` holding an `<aside class="cl-hero-why">`, one `<nav>`
  // (the shared actions), one `<main>` and a footer.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast`
  // is allowed to remain, and only because the arithmetic walk below judges
  // those ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  // The aria-hidden walk, exemption lifted — axe skips this text entirely and
  // the default walk honours the same boundary, so this second call is the
  // ONLY thing that ever measures it. See `contrast.ts` for the inventory.
  const hiddenContrast = Array.from(
    new Set(
      formatContrastFailures(
        await auditContrast(page, '[aria-hidden="true"], [aria-hidden="true"] *', true)
      )
    )
  );
  softExpect(hiddenContrast, `measured aria-hidden contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}


// ── The drive ───────────────────────────────────────────────────────────────

/**
 * Assert focus landed where the reader left it (WCAG 3.2.x, and plain
 * usability).
 *
 * Every action on this page replaces the controls, so focus restoration is a
 * property of the implementation rather than of the browser. Before it existed,
 * a click on "Change one bit" dropped focus to the body -- so a keyboard reader
 * lost their place on every single interaction, and no axe rule says a word
 * about it.
 */
async function expectFocus(page: Page, id: string, after: string): Promise<void> {
  const actual = await page.evaluate(() => document.activeElement?.id ?? '(body)');
  expect(actual, `focus must stay on #${id} after ${after}`).toBe(id);
}

/** Click a control and assert the reader is still standing on it. */
async function clickKeepingFocus(page: Page, id: string, label: string): Promise<void> {
  await page.locator(`#${id}`).focus();
  await page.locator(`#${id}`).click();
  await expectFocus(page, id, label);
}

/**
 * Drive the lab through every state it teaches, scanning each.
 *
 * Four things shape this drive:
 *
 *  - THE ARRIVAL STATE IS THE GUIDED LESSON, exactly as a reader gets it: step
 *    1 of 5, the real github.com chain, every check passing, only the site
 *    chooser on screen, every disclosure shut.
 *
 *  - EVERY FAILURE AND ALARM STATE, reached through the lesson's own controls:
 *    a mismatched address, a date past expiry and before the window, a one-bit
 *    signature flip, the self-signed chain, and the attacker chain whose every
 *    check passes and whose verdict is ALARM. None is reachable without
 *    deliberately breaking something, and each repaints a row border and a
 *    wash the non-text oracle has to judge.
 *
 *  - THE INTERACTION PROPERTIES axe cannot see: focus surviving every action,
 *    an open disclosure surviving a recomputation, and a definition panel
 *    opening from the keyboard. These are asserted at every width, because 320
 *    is where the shared top bar stops widening its touch targets and where a
 *    reflow failure would hide them.
 *
 *  - NO FIXED TIMEOUTS. Every wait is on a real DOM signal: a `data-result`, a
 *    `data-claim`'s text, `aria-pressed`, a radio's checked state.
 */
export async function driveAllStates(page: Page, label: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${label} / ${s}`);

  await scanAt('arrival: the guided lesson, step 1 of 5, all four checks passing');

  // ── The shared skip link, focused ───────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the shared skip link focused, slid in from top:-3rem');

  // ── An inline definition, opened from the KEYBOARD ──────────────────────
  const define = page.locator('#intro .define').first();
  await define.focus();
  await page.keyboard.press('Enter');
  await expect(define).toHaveAttribute('aria-expanded', 'true');
  await scanAt('an inline definition open, reached by keyboard rather than hover');
  await page.keyboard.press('Enter');
  await expect(define).toHaveAttribute('aria-expanded', 'false');

  // ── Step 2: the name check, with a prediction answered both ways ────────
  await page.locator('#step-next').click();
  await expect(page.locator('[data-claim="step-progress"]')).toHaveText('Step 2 of 5.');
  await scanAt('step 2: the prediction unanswered, the address control on screen');

  await page.locator('#predict-name-must-match-still-padlock').check();
  await expect(page.locator('[data-verdict="prediction"]')).toHaveAttribute('data-result', 'fail');
  await scanAt('step 2: a wrong prediction, with its explanation shown');
  await page.locator('#predict-name-must-match-no-padlock').check();
  await expect(page.locator('[data-verdict="prediction"]')).toHaveAttribute('data-result', 'pass');
  await scanAt('step 2: a right prediction');

  await page.locator('#address-input').fill('evil.example');
  await expect(page.locator('[data-verdict="promise-name"]')).toHaveAttribute('data-result', 'fail');
  await expect(page.locator('[data-verdict="padlock"]')).toHaveAttribute('data-result', 'fail');
  await expectFocus(page, 'address-input', 'typing an address');
  await scanAt('name check failing: NO PADLOCK, the cause shown, the causal summary painted');

  await page.locator('#address-input').fill('not a hostname!');
  await expect(page.locator('[data-verdict="promise-name"]')).toHaveAttribute('data-result', 'fail');
  await scanAt('name check failing closed on a malformed address');

  // A pasted URL, which a reader asked for "the address" really will paste.
  await page.locator('#address-input').fill('https://github.com/owner/repo');
  await expect(page.locator('[data-verdict="promise-name"]')).toHaveAttribute('data-result', 'pass');
  await scanAt('a pasted URL, reduced to its host and matching');

  // ── Step 3: the clock, driven by its presets ────────────────────────────
  await page.locator('#step-next').click();
  await expect(page.locator('[data-claim="step-progress"]')).toHaveText('Step 3 of 5.');
  await clickKeepingFocus(page, 'preset-expired', 'the expired date preset');
  await expect(page.locator('[data-verdict="promise-time"]')).toHaveAttribute('data-result', 'fail');
  await scanAt('expired: the dates red, every signature still verifying');

  await clickKeepingFocus(page, 'preset-early', 'the before-the-window preset');
  await expect(page.locator('[data-verdict="promise-time"]')).toHaveAttribute('data-result', 'fail');
  await scanAt('not yet valid: the other side of the validity window');

  // An invalid date, which paints aria-invalid and an error tied to the input.
  await page.locator('#date-input').fill('');
  await page.locator('#date-input').dispatchEvent('change');
  await scanAt('the date control with an unusable value and its error announced');
  await clickKeepingFocus(page, 'preset-valid', 'the in-window preset');
  await expect(page.locator('[data-verdict="promise-time"]')).toHaveAttribute('data-result', 'pass');

  // ── Step 4: one bit of the signature ───────────────────────────────────
  await page.locator('#step-next').click();
  await expect(page.locator('[data-claim="step-progress"]')).toHaveText('Step 4 of 5.');
  await clickKeepingFocus(page, 'tamper-btn', 'tampering with the signature');
  await expect(page.locator('#tamper-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-verdict="promise-vouched"]')).toHaveAttribute('data-result', 'fail');
  await scanAt('signature tampered: the vouching check red, the button pressed and hovered');

  // The chain detail, opened the way a reader opens it -- and it must SURVIVE
  // the next recomputation.
  await page.locator('details[data-disclosure="chain"] > summary').click();
  await expect(page.locator('details[data-disclosure="chain"]')).toHaveJSProperty('open', true);
  await scanAt('the chain walk open, with a failing link named');
  await clickKeepingFocus(page, 'tamper-btn', 'restoring the signature');
  await expect(page.locator('details[data-disclosure="chain"]'), 'an open disclosure must survive a recompute')
    .toHaveJSProperty('open', true);
  await scanAt('the chain walk STILL open after a recompute, signature restored');

  // ── Step 5: the ALARM ──────────────────────────────────────────────────
  await page.locator('#step-next').click();
  await expect(page.locator('[data-claim="step-progress"]')).toHaveText('Step 5 of 5.');
  await expect(page.locator('[data-verdict="padlock"]')).toHaveAttribute('data-result', 'alarm');
  await expect(page.locator('#promises .summary-row[data-result="pass"]')).toHaveCount(4);
  await scanAt('ALARM: the attacker chain, every check passing, the verdict not green');

  // ── The closing check ──────────────────────────────────────────────────
  await page.locator('#step-next').click();
  await expect(page.locator('input[name^="quiz-"]')).toHaveCount(9);
  await scanAt('the three-question check, unanswered');
  await page.locator('#quiz-lookalike-yes').check();
  await expect(page.locator('[data-verdict="quiz-lookalike"]')).toHaveAttribute('data-result', 'fail');
  await scanAt('a wrong answer, explained, offering the experiment again');
  await page.locator('#quiz-lookalike-no').check();
  await expect(page.locator('[data-verdict="quiz-lookalike"]')).toHaveAttribute('data-result', 'pass');
  await scanAt('a right answer');

  // ── The depth sections, all open at once ───────────────────────────────
  for (const key of ['wire', 'scope', 'next-all']) {
    await page.locator(`details[data-disclosure="${key}"] > summary`).click();
    await expect(page.locator(`details[data-disclosure="${key}"]`)).toHaveJSProperty('open', true);
  }
  await scanAt('every depth disclosure open: the bytes, the scope, the other labs');

  // ── Explore mode: every control at once ────────────────────────────────
  await clickKeepingFocus(page, 'mode-explore', 'switching to explore mode');
  await expect(page.locator('#address-input')).toHaveCount(1);
  await expect(page.locator('#date-input')).toHaveCount(1);
  await expect(page.locator('#tamper-btn')).toHaveCount(1);
  await scanAt('explore mode: every control on screen at once');

  await page.locator('#site-self-signed').check();
  await expectFocus(page, 'site-self-signed', 'choosing the self-signed chain');
  await expect(page.locator('[data-verdict="promise-vouched"]')).toHaveAttribute('data-result', 'fail');
  await scanAt('explore: the self-signed chain, nobody vouched');

  // Hover is a state, and it persists after a click.
  await page.locator('label[for="site-github-real"]').hover();
  await scanAt('a site row hovered');

  // ── Focus rings on every control type ──────────────────────────────────
  for (const id of ['address-input', 'date-input', 'reset-btn', 'mode-lesson']) {
    await page.locator(`#${id}`).focus();
    await scanAt(`#${id} focused`);
  }

  // ── Back to the arrival state through the page's own control ───────────
  await clickKeepingFocus(page, 'mode-lesson', 'switching back to the lesson');
  await expect(page.locator('#site-github-real')).toBeChecked();
  await scanAt('back in the lesson, at the state a reader arrives in');
}
