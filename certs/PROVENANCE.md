# Where these bytes came from

Every file here is a real X.509 certificate in PEM. Nothing in this directory is
synthesised for appearance, and nothing is a placeholder.

## The real chain, captured from the public internet

Captured 2026-10-04 with:

    openssl s_client -connect github.com:443 -servername github.com -showcerts

`github.com` was chosen over a prettier example for one reason: its issuing CA
is called **Sectigo Public Server Authentication CA DV E36**. The CA names its
own validation level in its own subject, and the leaf's subject is `CN=github.com`
with no organization field at all. That is non-promise 2 -- "not that the company
is who it says" -- written by the certificate rather than by this lab.

The served chain ends at a cross-signed copy of the root. Its own issuer,
`USERTrust ECC Certification Authority`, is not in the chain. That is not an
error and it is the whole of promise 3: the walk stops at a certificate already
on the device, never because something in the chain said to stop.

## The device trust store

`store-*.pem` are the two anchors this lab's store holds, taken from the real
macOS system trust store:

    security find-certificate -a -c "<name>" -p \
      /System/Library/Keychains/SystemRootCertificates.keychain

They are in the store because an operating system vendor put them there. This
lab does not and cannot verify that decision -- it is the axiom the whole padlock
rests on, which is why the lab names it rather than hiding it.

## The toy hierarchy

`toy-*.pem` are minted by `scripts/mint-toy-pki.mjs` and committed, so the
known-answer tests have known bytes to assert. Real P-256 keys, real DER, real
ECDSA signatures over real TBS bytes. The root is a toy because no real device
carries it, not because any of the cryptography is pretended.

`toy-attacker-leaf.pem` is the lab's sharpest exhibit: a perfectly valid
certificate for `login.yourbank-security.example`, a name under the RFC 2606
reserved `.example` TLD that can never belong to anyone. Every check this lab
performs passes on it. That is the point.

## Fingerprints

| File | Subject | SHA-256 |
|---|---|---|
| `real-github-crosssigned-root.pem` | C=GB, O=Sectigo Limited, CN=Sectigo Public Server Authentication Root E46 | `ea6b89ed6907a209ff9188676fb164e7aced894b8996dfbe5ce5bbcc22de4ddd` |
| `real-github-intermediate.pem` | C=GB, O=Sectigo Limited, CN=Sectigo Public Server Authentication CA DV E36 | `873f0ba80e3ac222656dfd04158cc15c2927d42d5d05f01dee4a47eb43a916df` |
| `real-github-leaf.pem` | CN=github.com | `46b601ee08b418cf8a3a1ebfe670ba5ce43bb05a917fa8b2dd087a30471cfc63` |
| `store-sectigo-root-e46.pem` | C=GB, O=Sectigo Limited, CN=Sectigo Public Server Authentication Root E46 | `c90f26f0fb1b4018b22227519b5ca2b53e2ca5b3be5cf18efe1bef47380c5383` |
| `store-usertrust-ecc.pem` | C=US, ST=New Jersey, L=Jersey City, O=The USERTRUST Network, CN=USERTrust ECC Certification Authority | `4ff460d54b9c86dabfbcfc5712e0400d2bed3fbc4d4fbdaa86e06adcd2a9ad7a` |
| `toy-attacker-leaf.pem` | CN=login.yourbank-security.example | `6da070b674f83c28da5745bfb5d327c47b3253e57263399c61426ca146e3005f` |
| `toy-dv-ca.pem` | CN=Padlock Lab Toy DV CA, O=HTTPS Padlock Lab | `e01d40c54566b5bcf1e504a215f8d5ec0136bb5f0b4b973da539d5f319e88bbd` |
| `toy-root.pem` | CN=Padlock Lab Toy Root, O=HTTPS Padlock Lab | `ba5ddbc024f4a44651cf3e283a2ca46e954c1ab23ea71f228e33dac01383ba29` |
| `toy-selfsigned-leaf.pem` | CN=selfsigned.padlock.example | `557143edcfb2af2687f71a24823f039584b3e06f6c21103175376a53cbd2f74c` |

Re-minting the toy certificates rotates their keys and therefore these
fingerprints. The known-answer fields -- subject, issuer, validity, SANs --
are stable by construction, so the tests survive a re-mint; this table does
not. Update it when you re-mint.
