import ghLeaf from '../../certs/real-github-leaf.pem?raw'
import ghIntermediate from '../../certs/real-github-intermediate.pem?raw'
import ghCrossRoot from '../../certs/real-github-crosssigned-root.pem?raw'
import storeSectigo from '../../certs/store-sectigo-root-e46.pem?raw'
import storeUsertrust from '../../certs/store-usertrust-ecc.pem?raw'
import toyRoot from '../../certs/toy-root.pem?raw'
import toyDvCa from '../../certs/toy-dv-ca.pem?raw'
import toyAttackerLeaf from '../../certs/toy-attacker-leaf.pem?raw'
import toySelfSignedLeaf from '../../certs/toy-selfsigned-leaf.pem?raw'
import { makeStore } from './path'

export const PEM = {
  ghLeaf, ghIntermediate, ghCrossRoot,
  storeSectigo, storeUsertrust,
  toyRoot, toyDvCa, toyAttackerLeaf, toySelfSignedLeaf,
} as const

/**
 * The device trust store.
 *
 * Two real anchors lifted out of the macOS system store, and one toy anchor
 * this lab adds so the attacker-name exhibit can be walked to completion. The
 * `why` strings are quoted on the page, because "why is this trusted" is the
 * question promise 3 exists to answer and the answer is never cryptographic.
 */
export const DEVICE_STORE = makeStore([
  {
    pem: storeSectigo,
    why: 'Your operating system vendor shipped it. That is the entire reason.',
  },
  {
    pem: storeUsertrust,
    why: 'Your operating system vendor shipped it. That is the entire reason.',
  },
  {
    pem: toyRoot,
    why: 'This lab put it here, so you can watch what happens when a certificate authority you trust signs a name an attacker controls.',
  },
])

export interface Scenario {
  readonly id: string
  readonly site: string
  /** The address a reader would have typed to arrive here. */
  readonly address: string
  readonly chain: readonly string[]
  readonly summary: string
  readonly real: boolean
}

/**
 * The chains the lab ships. Leaf first, exactly as a server sends them.
 *
 * `github-real` is the chain github.com actually served on 2026-10-04, served
 * cross-signed root included, because that is what a real server sends and the
 * redundant top certificate is itself a teaching point.
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'github-real',
    site: 'github.com',
    address: 'github.com',
    chain: [ghLeaf, ghIntermediate, ghCrossRoot],
    summary: 'The certificate github.com really presented, captured from the public internet.',
    real: true,
  },
  {
    id: 'attacker-name',
    site: 'login.yourbank-security.example',
    address: 'login.yourbank-security.example',
    chain: [toyAttackerLeaf, toyDvCa],
    summary: 'A flawless certificate for a name that is not your bank. Every check passes.',
    real: false,
  },
  {
    id: 'self-signed',
    site: 'selfsigned.padlock.example',
    address: 'selfsigned.padlock.example',
    chain: [toySelfSignedLeaf],
    summary: 'A certificate that signed itself. Nobody vouched for it.',
    real: false,
  },
]

export function scenario(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id)
  if (!s) throw new Error(`unknown scenario: ${id}`)
  return s
}
