/**
 * The closing check: three questions, each about something the reader just did.
 *
 * Not a score and not a completion badge -- master template section 2 asks that
 * poking at the thing builds the mental model, and a badge for clicking through
 * measures clicking. Each wrong answer gets the explanation immediately and an
 * offer to go back and redo the experiment that shows it, because the
 * experiment is the argument and the sentence is only its summary.
 *
 * The questions are deliberately about the three things readers get wrong in
 * that order: that passing checks mean a trustworthy operator, that expiry is a
 * cryptographic failure, and that a name which merely contains the right
 * hostname is the right hostname.
 */

export interface QuizOption {
  readonly id: string
  readonly label: string
  readonly correct: boolean
  readonly why: string
}

export interface Question {
  readonly id: string
  readonly prompt: string
  readonly options: readonly QuizOption[]
  /** The lesson step whose experiment settles this, for "try it again". */
  readonly revisitStep: number
}

export const QUESTIONS: readonly Question[] = [
  {
    id: 'lookalike',
    prompt:
      'A lookalike site passes every certificate check. Has that established that it is your bank?',
    revisitStep: 4,
    options: [
      {
        id: 'no',
        label: 'No -- the certificate matches the name, not your intention',
        correct: true,
        why: 'Right. Every check was about the name in the address bar and the chain behind it. The attacker controls that name, so the checks pass honestly -- and say nothing about who is running it.',
      },
      {
        id: 'yes',
        label: 'Yes -- all the checks passed',
        correct: false,
        why: 'The checks passing is exactly what the lookalike exhibit shows. What passed was "this certificate is validly issued for this name". Nobody validated who the name belongs to.',
      },
      {
        id: 'probably',
        label: 'Probably -- a real authority would not issue to a fake bank',
        correct: false,
        why: 'A real authority will. Domain validation checks control of a name and nothing more, which is what almost every certificate on the web attests -- including the one you just looked at.',
      },
    ],
  },
  {
    id: 'expiry',
    prompt:
      'Only the checking date moved past expiry. Did that make the signatures stop verifying?',
    revisitStep: 2,
    options: [
      {
        id: 'no',
        label: 'No -- date validity and signature verification are different checks',
        correct: true,
        why: 'Right. You watched every signature still verify with the date out of range. Expiry bounds how long anyone has to keep a key safe; it is not a statement about the mathematics.',
      },
      {
        id: 'yes',
        label: 'Yes -- an expired certificate is cryptographically broken',
        correct: false,
        why: 'Go back to step 3 and look at the chain detail with the date moved: every link still verifies. Nothing about the signatures changed when the date did.',
      },
      {
        id: 'partly',
        label: 'Partly -- the leaf fails but the rest still verifies',
        correct: false,
        why: 'The leaf signature verifies too. What failed is a comparison between two dates, which is a different kind of check entirely.',
      },
    ],
  },
  {
    id: 'suffix',
    prompt:
      'A certificate for github.com is presented when you asked for github.com.evil.example. Does the name match?',
    revisitStep: 1,
    options: [
      {
        id: 'no',
        label: 'No -- that is a different hostname',
        correct: true,
        why: 'Right. "github.com.evil.example" is a name under evil.example, and matching is on whole labels from the right, so a certificate for github.com does not cover it.',
      },
      {
        id: 'yes',
        label: 'Yes -- github.com appears in the address',
        correct: false,
        why: 'Appearing in the address is not matching. Read it from the right: the domain here is evil.example, and anything before it is just a label they chose. Try typing it in step 2.',
      },
      {
        id: 'wildcard',
        label: 'Yes, if the certificate has a wildcard',
        correct: false,
        why: 'A wildcard stands for one label in the name it belongs to -- "*.github.com" covers www.github.com, and nothing under evil.example. That is why "*.com" cannot exist.',
      },
    ],
  },
]

/** The practical advice to leave a reader with, which is the point of the lab. */
export const TAKEAWAYS: readonly string[] = [
  'Type the address yourself, or use a bookmark you made. Nearly every lookalike attack starts with a link somebody else chose.',
  'HTTPS is necessary and it is not a verdict on who you are talking to. Its absence is a problem; its presence is not a reference.',
  'If your browser warns you about a certificate, do not click through it. That warning means a check this page just taught you about actually failed.',
  'A self-signed certificate being untrusted here does not make it malicious -- plenty are internal and perfectly honest. It means nobody your device trusts has vouched for it, so you have no way to tell.',
]

export const BROWSER_ICON_NOTE =
  'Browsers no longer agree on the icon. Chrome replaced its padlock in 2023 with a neutral control, precisely because the lock was being read as a safety badge -- the misreading this page is about. Whatever your browser draws, the four checks underneath it are the same.'
