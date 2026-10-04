# HTTPS Padlock

**X.509 · TLS 1.3 · what the padlock means**

Parses the real certificate a site presents, walks the chain to a root that was trusted before
you arrived, and separates the four things the padlock proves from the four it does not.

**[Open the live demo](https://systemslibrarian.github.io/crypto-lab-https-padlock/)**

---

## What It Is

Almost everyone has been told the padlock means a site is safe. It does not say that, and it
never did. This lab is the one place in the Crypto Lab suite that answers the newcomer's
question — *what does the padlock mean?* — and then sends them on.

It parses real X.509 certificates in the browser with
[`@peculiar/x509`](https://github.com/PeculiarVentures/x509), verifies every signature in the
chain with **WebCrypto**, and encodes a real TLS 1.3 `ClientHello` byte for byte so you can
find the hostname in it yourself.

- **Primitives and specs.** RFC 5280 (X.509 path validation, a stated teaching subset),
  RFC 8446 (TLS 1.3 `ClientHello`), RFC 6066 (server_name / SNI), RFC 6125 (name matching).
  Signatures are real ECDSA over P-256 and P-384, verified in `SubtleCrypto`.
- **The security model.** The lab reads certificates that were already captured. It makes no
  network connection and runs no handshake, so it never claims to have *observed* encryption.
  What it does claim about the certificate's key is narrow and correct: in TLS 1.3 that key
  checks the server's handshake signature, and it is **not** the key your traffic is encrypted
  to — that was RSA key transport, which TLS 1.3 removed. Trust terminates in a list of roots
  that is **this lab's own copy**, not your device's; the lab cannot read or change what your
  machine trusts, and says so on the page.
- **Not production crypto.** This is a teaching demo. Its path validation deliberately omits
  revocation, name constraints, policy constraints and path length, so a chain this page
  accepts is **not** thereby a chain a browser would accept.

### What is real, and what is not

| Real | Not real, or not here |
|---|---|
| The `github.com` chain, captured from the public internet on 2026-10-04 | Any live network connection or TLS handshake |
| Two roots lifted from a real macOS system trust store | Your device's actual trust list — this is the lab's committed copy of one, plus an extra toy root |
| Every signature check, in WebCrypto, over real DER | Revocation (OCSP/CRL), name constraints, policy constraints, path length |
| The toy hierarchy: real P-256 keys, real signatures over real TBS bytes | The toy root's *trustworthiness* — no real device carries it; the lab adds it on purpose |
| The `ClientHello`: correct lengths, a real X25519 public key, and the four extensions RFC 8446 §9.2 requires | Sending that message, or using the key — the private half is discarded unused |

The certificates and their provenance are documented in [`certs/PROVENANCE.md`](certs/PROVENANCE.md),
including the command each was captured with.

## Exhibits

1. **Pick a site, and set the date.** Three real certificate chains: the one `github.com`
   actually served, a flawless certificate for a name that is not your bank, and a certificate
   that signed itself. Plus the address you *think* you are visiting, and the date you are
   checking.
2. **The padlock.** One verdict, computed from the four checks below. It reads `PADLOCK SHOWN`,
   `NO PADLOCK`, or — for the attacker certificate — `PADLOCK SHOWN — AND NOT WHO YOU THINK`.
3. **The chain walk.** Leaf, intermediate, root, drawn as boxes with the verdict on each
   signature between them. The last box is marked as the one the **server never sent** — it
   came from the trusted list, and nothing in the chain vouches for it. On a real device that
   list ships with the operating system or browser; this lab carries its own copy.
4. **The four promises.** A usable key — imported by WebCrypto, with what it is actually for
   spelled out; the name matches, under RFC 6125, after extracting the host from whatever you
   typed; somebody vouched; it has not expired. Each one shows the value it actually read.
5. **Break it yourself.** Type an address the certificate is not for. Move the date past the
   expiry. Flip one bit of the signature. Each failure is produced by the real validator, and
   the page names the actual cause.
6. **The four non-promises.** Not that the site is honest; not that the company is who it says;
   not that the hostname was private; not that the strongest cryptography was used. Each is
   *demonstrated* rather than asserted.
7. **The first message your browser sends.** A real TLS 1.3 `ClientHello`, in hex, with the
   hostname highlighted where it sits in the clear.
8. **Show the bytes.** Progressive disclosure: the certificate's own fields as a table, and
   what each part of the `ClientHello` is, both one click away and neither on screen until asked
   for.

## When to Use It

- **Use it** to answer "what does the padlock mean?" for someone who has never seen a
  certificate, and to show why a valid padlock on a lookalike domain is not a contradiction.
- **Use it** to show the difference between a name being verified and an organization being
  verified.
- **Do NOT use it** as a certificate validator. It implements a teaching subset of RFC 5280 and
  will accept chains a browser rejects. Use a real TLS stack.
- **Do NOT use it** to learn path building — cross-signing, name constraints, path length. That
  is [Chain of Trust](https://systemslibrarian.github.io/crypto-lab-chain-of-trust/), which is
  a deliberately narrower and deeper question.

## Live Demo

**<https://systemslibrarian.github.io/crypto-lab-https-padlock/>**

Choose a site, then try to break each promise in turn: retype the address, drag the date past
29 November 2026, flip a bit of the signature. Then select
`login.yourbank-security.example` and watch every check pass.

## What Can Go Wrong

- **Reading the padlock as a safety badge.** It is a statement about a connection and a name.
  The attacker exhibit exists because this is the single most common and most costly
  misreading, and it is a misreading of a *correct* result.
- **Expecting a domain-validated certificate to identify a company.** It attests control of a
  name. `CN=github.com` carries no organization field at all, and its issuing CA has `DV` in
  its own name.
- **Assuming the hostname is private.** It is in the clear in the first packet, in this
  example — Encrypted ClientHello is the extension that hides it, and this message does not
  use one. [Blind Hello](https://systemslibrarian.github.io/crypto-lab-blind-hello/) is the lab
  for that fix.
- **Assuming the best cryptography was negotiated.** Negotiation happens before anyone has
  authenticated — though TLS 1.3 *does* check afterwards that the conversation was not
  altered, so this is not a free downgrade. What a padlock still does not tell you is which
  option was chosen.
  [Downgrade Wire](https://systemslibrarian.github.io/crypto-lab-downgrade-wire/) goes into it.
- **Trusting a chain because it validates.** Validation is a statement about signatures, names
  and dates. The lab's own store contains a toy root precisely so you can watch a perfect
  validation of a certificate you should not trust.
- **Confusing the lab's clock with yours.** The lab pins its own instant, stated on the page,
  so the expiry lesson cannot rot into an accident.

## Real-World Usage

Every browser, every HTTPS client and every TLS library performs the four checks this lab
shows, on every connection. The shape of the `github.com` chain here — a leaf, a
domain-validated issuing CA, and a cross-signed root whose own issuer arrives from the device
rather than the wire — is the ordinary modern case, not an edge case. Certificate
transparency, HSTS, CAA records and DANE all exist because of the gaps this lab's second half
is about.

## How to Run Locally

```sh
npm install
npm run dev          # http://localhost:5173/crypto-lab-https-padlock/
```

Other scripts:

```sh
npm test             # unit and known-answer tests
npm run build        # typecheck both projects, then build
npm run test:a11y    # the axe WCAG gate at 1280 / 390 / 320
npm run test:verdicts   # the claims suite and the verdict-coverage rule
npm run test:mutation   # prove the tests bite (see below)
npm run mint:toy     # re-mint the toy hierarchy (rotates its keys)
```

## Related Demos

- **[Chain of Trust](https://systemslibrarian.github.io/crypto-lab-chain-of-trust/)** — path
  building versus RFC 5280 path validation, including every constraint this lab omits.
- **[TLS Handshake](https://systemslibrarian.github.io/crypto-lab-tls-handshake/)** — the
  handshake itself, which this lab takes for granted.
- **[Blind Hello](https://systemslibrarian.github.io/crypto-lab-blind-hello/)** — encrypting
  the hostname this lab shows in the clear.
- **[Downgrade Wire](https://systemslibrarian.github.io/crypto-lab-downgrade-wire/)** —
  stripping the unauthenticated negotiation.
- **[DNSSEC Chain](https://systemslibrarian.github.io/crypto-lab-dnssec-chain/)** — a separate
  trust system answering a different question.

## Build & Verify

**57 unit tests** (Vitest), all passing, across six files:

| File | What it proves |
|---|---|
| `src/pki/kat.test.ts` | **13 known-answer tests.** Every vendored chain parses to the subject, issuer, serial, validity window, SANs and SHA-256 fingerprint that `openssl x509` reports. The expected values are literals read out of the certificates *before* this lab could parse them. |
| `src/pki/hostname.test.ts` | RFC 6125 matching: exact names, wildcards standing for exactly one label, the ignored Common Name, host extraction from a pasted URL the way a browser does it, and fail-closed behaviour on anything that is not a plain DNS name. |
| `src/pki/path.test.ts` | The correct path accepts the good chain and **rejects every bad one** — missing intermediate, one-byte signature alteration, expired, self-signed leaf, a root the device does not hold, and a parent not permitted to sign. |
| `src/pki/assess.test.ts` | Every verdict the page renders, computed: which checks fail for which breakage, that promise 1 reports a key WebCrypto actually **imported** rather than a parsed field, and that the attacker fixture renders **ALARM** rather than a green success. |
| `src/tls/clienthello.test.ts` | The `ClientHello` encoder, checked by an **independent structural walk** of the TLS message that shares no arithmetic with the encoder's own offsets, plus a check that all five required extensions are present and that the browser path really produces an X25519 key. |
| `src/tls/span.test.ts` | The declared position of the hostname against a byte search, at every length from 1 to 200 — including the n=97 case where the name's own length prefix encodes as the letter `a` and a naive search lands one byte early. |

**The accessibility gate** (`npm run test:a11y`) scans the *production build* in Chromium for
zero WCAG 2.1 A/AA violations, at **1280, 390 and 320 px**, across every state the lab
teaches — including each failure, the alarm, both disclosures open, and three focus rings.
It is not an axe wrapper: it also asserts axe's `incomplete` bucket, computes contrast
arithmetically over every text node (including `aria-hidden` content axe skips), measures
non-text contrast against a ratchet baseline, and checks reflow, which axe has no rule for.
The deploy is blocked if it fails.

**The claims suite** (`npm run test:verdicts`) checks the page tells the truth: **34 claims
tests plus 4 coverage rules**. The three biggest claims are **re-derived independently** in the
test rather than recomputed the way the source computes them — RFC 6125 matching is implemented
a second time in the spec, expiry is recomputed from the dates printed on screen, and the
hostname's position in the `ClientHello` is found by searching the page's own printed bytes
(anchored on the name's length prefix, because at length 97 that prefix encodes as the letter
`a` and a naive search lands one byte early).

It also sweeps for **self-contradiction**. The page shipped a real one: with the date past
expiry the headline read `NO PADLOCK` while the honesty card still said "Every check above
passed", because the every-check-passed value ignored expiry. Nothing caught it, since that row
was only ever asserted in the state where every check really does pass. The suite now drives
all six breakages and asserts no passing-everything sentence survives any of them — and the
other side of the ratchet, that the sentence *is* shown when nothing is broken.

**Mutation discipline.** `npm run test:mutation` applies **15 recorded mutations** covering
**18 marker assertions** — one per verdict the lab renders, plus one that re-introduces the
self-contradiction above so the fix is itself pinned — in an isolated `git archive`
tree, and judges each against four rules: the owning test passed unmutated in the same run,
the patch actually changed the file, the run served the mutated code (the bundle hash must
move *and* the failure must not match a build error or a dead server), and a patch that does
not compile is `DOES NOT BUILD` rather than a kill. The results in
[`e2e/mutation-evidence.json`](e2e/mutation-evidence.json) are written by the runner, not by
hand. Separately, `e2e/global-teardown.ts` fails the suite if any recorded kill never actually
executed, so an unperformed record cannot sit in the registry looking performed — and when a
copy edit legitimately moves a recorded claim, `npm run sync:kills` copies the new string out
of a passing run's own sink instead of having someone retype what they believe the run did. It
refuses to guess where the choice is a judgement.

**The negative claim.** *A valid certificate does not establish who operates the name it was
issued for.* Its evidence fixture is the attacker chain: a reachable state where every check
reports success and the named property is violated anyway. The claims suite asserts the
fixture is reachable, that every rendered verdict in it reports success, and that the
limitation is on screen in that state as the lab's own check returning `not established`.

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
