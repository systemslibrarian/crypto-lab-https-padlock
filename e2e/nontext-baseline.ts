/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can
 * paint outside its host and the oracle measures it against the host's
 * backdrop, so that ratio is NOT trustworthy -- hand-measure before acting.
 *
 * IT IS EMPTY, AND THAT IS THE POINT -- this is the terminal state of the
 * ratchet, not an unrun check. The palette in src/style.css was authored
 * against the 3:1 floor before the first gate run rather than fixed afterwards:
 * every control boundary is `--border-strong` (#6e7d8d), measured at 4.10:1 on
 * `--surface`, 3.76:1 on `--surface-2` and 4.49:1 on `--bg`, and the four state
 * inks that override it on a `.check` row sit between 6.94:1 and 10.73:1. The
 * shared top bar's `.cl-btn`, baselined in older labs at ~1.49:1, already draws
 * its edge from `--cl-ink` here and clears 3:1 -- which is why the two entries
 * most of this fleet carries are absent too.
 *
 * A run with `NT_BASELINE_CAPTURE=1` set prints every finding through this same
 * path and asserts nothing, which is how this file is regenerated.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {};
