/** The role a certificate plays in a chain, which is what the lab draws. */
export type Role = 'leaf' | 'intermediate' | 'root'

/** One of the four things the padlock proves, or one of the four it does not. */
export type Outcome = 'pass' | 'fail' | 'not-established' | 'out-of-scope'

/**
 * A check's result. `detail` is plain language, written for someone who has
 * never seen a certificate; `evidence` is the value the check actually read, so
 * a reader can see the check was performed rather than asserted.
 */
export interface CheckResult {
  readonly id: string
  readonly outcome: Outcome
  readonly headline: string
  readonly detail: string
  readonly evidence: readonly { label: string; value: string }[]
}

/** One link in the walk: this certificate, signed by the one above it. */
export interface Link {
  readonly childIndex: number
  readonly childName: string
  readonly issuerName: string
  readonly verified: boolean
  /** Why a link failed, in plain language. Empty when it verified. */
  readonly reason: string
}

export interface NameMatch {
  readonly address: string
  readonly matched: boolean
  /** The SAN entry that matched, or '' when none did. */
  readonly via: string
  readonly presented: readonly string[]
  /** True when the match came from a wildcard rather than an exact name. */
  readonly wildcard: boolean
}

export interface Validity {
  readonly notBefore: Date
  readonly notAfter: Date
  readonly at: Date
  readonly inWindow: boolean
  /** 'before' / 'after' / '' -- which side of the window the instant fell. */
  readonly side: 'before' | 'after' | ''
}
