/**
 * The lab's clock.
 *
 * Certificates expire, and this lab ships a real one. If "has it expired" were
 * asked of the reader's system clock, the lab would teach promise 4 correctly
 * for eight weeks and then teach a failure it never meant to teach -- every
 * visitor after 2026-11-29 would arrive at a dead padlock with no way to know
 * the lab had rotted rather than the lesson being "certificates expire".
 *
 * So the lab has its own clock, pinned to the instant the real chain was
 * captured, and says so on the page. The reader moves it; nothing reads
 * Date.now(). That is also what makes promise 4 a demonstration instead of an
 * accident: moving a date and watching a valid certificate become invalid, with
 * no cryptography changing, is the whole exhibit.
 */

/** The instant the real chain in certs/ was captured from github.com. */
export const CAPTURED_AT = new Date('2026-10-04T00:00:00Z')

/** Where the date control starts. The real leaf is inside its window here. */
export const DEFAULT_AT = CAPTURED_AT

/**
 * The range the date control spans.
 *
 * Wide enough to express EVERY date the shipped certificates make interesting,
 * which is a requirement rather than a preference: the date presets are derived
 * from each certificate's own notBefore/notAfter, and a preset outside this
 * range has to be dropped -- so the control silently disappeared for the toy
 * chain, whose window runs to 2036. A reader switching certificates lost a
 * button with no explanation.
 *
 * So the floor sits before the earliest notBefore (2026-01-01, the toy mint)
 * and the ceiling after the latest notAfter (2036-01-01, the same), each with a
 * year of margin to move around in.
 */
export const CLOCK_MIN = new Date('2025-01-01T00:00:00Z')
export const CLOCK_MAX = new Date('2037-01-01T00:00:00Z')

/** `YYYY-MM-DD`, which is what an `<input type="date">` exchanges. */
export function toDateInput(at: Date): string {
  return at.toISOString().slice(0, 10)
}

/**
 * Read a `YYYY-MM-DD` back. Returns null rather than an Invalid Date, so a
 * caller cannot accidentally propagate NaN into a comparison that then reports
 * "not expired" for every instant.
 */
export function fromDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const at = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(at.getTime()) ? null : at
}

/** A date a reader can read, not an ISO string. */
export function human(at: Date): string {
  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
