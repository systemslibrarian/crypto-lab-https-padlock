import { DEFAULT_AT, toDateInput } from '../pki/clock'

/**
 * The five-step guided lesson.
 *
 * The brief asks for a Beginner lab that answers one question and sends the
 * reader on. A reference page with controls does not do that: it presents
 * everything at once and leaves the newcomer to invent their own experiment.
 * So the lesson is the DEFAULT, and free exploration is one click away for
 * anyone who would rather poke at it.
 *
 * Each step has exactly one question, one action, one result to look at and one
 * takeaway, and each RESETS to a known baseline so a step cannot inherit a
 * previous step's half-finished experiment. The prediction is optional and
 * never gates progress -- a reader who skips it loses nothing but the moment of
 * being wrong, which is the moment that teaches.
 *
 * Nothing here simulates anything. Every step drives the same real validator
 * the explore mode drives; the lesson only decides what to point at.
 */

export interface Baseline {
  readonly scenarioId: string
  readonly address: string
  readonly date: string
  readonly tampered: boolean
}

export interface Prediction {
  readonly prompt: string
  /** The option that is correct, and why each option is or is not. */
  readonly options: readonly { id: string; label: string; correct: boolean; why: string }[]
}

export interface Step {
  readonly id: string
  readonly ordinal: number
  readonly title: string
  /** The one question this step answers. */
  readonly question: string
  /** What the reader should do, in one sentence. */
  readonly action: string
  /** Which controls this step needs. Everything else stays out of the way. */
  readonly controls: readonly ('site' | 'address' | 'date' | 'tamper')[]
  readonly baseline: Baseline
  readonly prediction?: Prediction
  /** What to look at once they have done it. */
  readonly result: string
  /** The sentence worth remembering. */
  readonly takeaway: string
}

const REAL: Baseline = {
  scenarioId: 'github-real',
  address: 'github.com',
  date: toDateInput(DEFAULT_AT),
  tampered: false,
}

export const STEPS: readonly Step[] = [
  {
    id: 'what-it-checks',
    ordinal: 1,
    title: 'What the padlock checks',
    question: 'When a browser shows a padlock, what has it actually checked?',
    action:
      'Nothing to change yet. This is the certificate github.com really presented. Read the four checks below -- that is the whole list.',
    controls: [],
    baseline: REAL,
    result:
      'All four checks pass, so a browser would show a padlock here. The list is short on purpose: four things, and nothing else.',
    takeaway:
      'The padlock is a statement about the connection and the name. Four checks, all of them about the certificate -- none of them about the people behind it.',
  },
  {
    id: 'name-must-match',
    ordinal: 2,
    title: 'The name has to match',
    question: 'What happens if the certificate is for a different name than the one you asked for?',
    action:
      'Change the address to something the certificate is not for -- try "evil.example", or anything you like.',
    controls: ['address'],
    baseline: REAL,
    prediction: {
      prompt: 'Before you change it: what do you expect?',
      options: [
        {
          id: 'still-padlock',
          label: 'Still a padlock -- the certificate is genuine',
          correct: false,
          why: 'The certificate is genuine, and that is not enough. A real certificate for the wrong name is exactly the case this check exists to stop.',
        },
        {
          id: 'no-padlock',
          label: 'No padlock -- the name is part of what is checked',
          correct: true,
          why: 'Right. A browser compares the address you asked for against the names in the certificate, and refuses to go on if they do not match.',
        },
        {
          id: 'warning-only',
          label: 'A padlock with a warning next to it',
          correct: false,
          why: 'Browsers do not soften this one. A name mismatch is a full stop, not a note -- it is the difference between the right site and somebody else holding a valid certificate.',
        },
      ],
    },
    result:
      'The name check fails and the padlock is gone. Look at what the page compared: the address you typed against the names the certificate actually lists.',
    takeaway:
      'A certificate is issued for specific names. It proves nothing at all about any other name, however genuine the certificate is.',
  },
  {
    id: 'dates-matter',
    ordinal: 3,
    title: 'Dates matter, and nothing else moves',
    question: 'If a certificate expires, does the cryptography stop working?',
    action:
      'Move the checking date past 29 November 2026 -- the "day after expiry" button does it in one click.',
    controls: ['date'],
    baseline: REAL,
    prediction: {
      prompt: 'Before you move it: what do you expect to break?',
      options: [
        {
          id: 'signatures-fail',
          label: 'The signatures stop verifying',
          correct: false,
          why: 'No -- and this is the surprising part. Every signature still verifies perfectly. Expiry is a separate rule about dates, not about mathematics.',
        },
        {
          id: 'only-date',
          label: 'Only the date check -- the signatures still verify',
          correct: true,
          why: 'Right. Nothing cryptographic changes. The chain is just as sound as it was; it is simply out of the window it was issued for.',
        },
        {
          id: 'nothing',
          label: 'Nothing -- expiry is only a recommendation',
          correct: false,
          why: 'Browsers enforce it. An expired certificate stops the connection, because nobody is promising to look after a key forever.',
        },
      ],
    },
    result:
      'The date check fails and every signature in the chain still verifies -- open the chain detail below and see for yourself.',
    takeaway:
      'Expiry is a promise about time, not about mathematics. It limits how long anyone has to keep a key safe.',
  },
  {
    id: 'somebody-vouched',
    ordinal: 4,
    title: 'Somebody has to vouch',
    question: 'Who says this certificate is genuine, and why would you believe them?',
    action:
      'Press "Change one bit of the signature". That really alters the certificate bytes, and the chain is really re-checked.',
    controls: ['tamper'],
    baseline: REAL,
    prediction: {
      prompt: 'Before you press it: one bit, out of thousands. What do you expect?',
      options: [
        {
          id: 'caught',
          label: 'Caught immediately -- the signature will not verify',
          correct: true,
          why: 'Right. A signature covers every byte. Change one and it fails -- there is no "close enough".',
        },
        {
          id: 'too-small',
          label: 'Too small to notice',
          correct: false,
          why: 'There is no such thing as a small change to a signed message. One bit is as detectable as a thousand.',
        },
        {
          id: 'depends',
          label: 'Depends which bit',
          correct: false,
          why: 'It does not. Every bit is covered. Any change at all breaks the signature.',
        },
      ],
    },
    result:
      'The vouching check fails and the page names which link broke. Put it back, then open the chain detail: the last certificate came from a trusted list, not from the server.',
    takeaway:
      'The chain is checked, not assumed -- and it ends at a root that was trusted before you arrived. That trust is a decision somebody made, not something the maths proves.',
  },
  {
    id: 'the-limit',
    ordinal: 5,
    title: 'A perfect certificate for the wrong site',
    question: 'If every check passes, does that mean you are where you meant to be?',
    action:
      'Switch to "login.yourbank-security.example" -- a name somebody could really register, with a real certificate from an authority the trusted list accepts.',
    controls: ['site'],
    baseline: {
      scenarioId: 'attacker-name',
      address: 'login.yourbank-security.example',
      date: toDateInput(DEFAULT_AT),
      tampered: false,
    },
    prediction: {
      prompt: 'Before you switch: how many of the four checks do you expect to fail?',
      options: [
        {
          id: 'some',
          label: 'At least one -- it is obviously not a real bank',
          correct: false,
          why: 'Nothing about "obviously" is in a certificate. All four pass, which is precisely why this matters.',
        },
        {
          id: 'none',
          label: 'None -- every check passes',
          correct: true,
          why: 'Right, and this is the whole lesson. Every check passes because every check is about the name and the chain, and the attacker genuinely controls that name.',
        },
        {
          id: 'depends-ca',
          label: 'Depends whether a real authority issued it',
          correct: false,
          why: 'A real authority would issue it. Domain validation checks that you control a name -- and an attacker who registered this name does control it.',
        },
      ],
    },
    result:
      'All four checks pass, and the verdict is an ALARM rather than a green padlock. The certificate is perfect. The site is still not your bank.',
    takeaway:
      'The padlock answers "is this the name I asked for, over a connection nobody can read" -- never "are these people who I hope they are". Read the address, not the icon.',
  },
]

export function step(index: number): Step {
  const s = STEPS[index]
  if (!s) throw new Error(`no lesson step at index ${index}`)
  return s
}

export const LAST_STEP = STEPS.length - 1
