/**
 * The words a newcomer will not know, defined where they appear.
 *
 * Master template section 2, lens 5: jargon introduced, not assumed. A glossary
 * at the bottom of a page is a glossary nobody reads, so each term is defined
 * at the moment it is first used.
 *
 * NOT ON HOVER. A hover tooltip is unreachable by keyboard, unreachable by
 * touch, and invisible to anyone who cannot hold a pointer still. These render
 * as a real `<button aria-expanded>` plus a panel, so Enter, Space and a tap
 * all work and the state is announced. WCAG 1.4.13 would also require a
 * hover-triggered popup to be dismissable, hoverable and persistent, which is
 * three rules to get wrong for no gain over a button.
 */

export interface Term {
  readonly id: string
  readonly word: string
  readonly definition: string
}

export const TERMS: readonly Term[] = [
  {
    id: 'certificate',
    word: 'certificate',
    definition:
      'A small file a website hands your browser. It says "this public key belongs to this name", and it is signed by somebody else so your browser can check it was not written by just anyone.',
  },
  {
    id: 'chain',
    word: 'chain',
    definition:
      'Certificates come in a line. The site\'s certificate is signed by an authority, whose certificate is signed by another, until you reach one your device already trusts. Each link is a signature your browser checks.',
  },
  {
    id: 'root',
    word: 'root',
    definition:
      'The last certificate in the line, which nobody signed for you -- it was already in a list of trusted roots before you visited. On a real device that list ships with the operating system or browser.',
  },
  {
    id: 'signature',
    word: 'signature',
    definition:
      'A number only the holder of a private key could have produced, which anyone with the matching public key can check. Change one byte of what was signed and the check fails.',
  },
  {
    id: 'public-key',
    word: 'public key',
    definition:
      'Half of a matched pair. The public half can be handed out freely and used to CHECK a signature; the private half is kept secret and is the only thing that can MAKE one.',
  },
  {
    id: 'domain-validated',
    word: 'domain-validated',
    definition:
      'The cheapest and commonest kind of certificate. The issuer checked only that whoever asked could answer for the name -- by replying to an email or serving a file. It checked nothing about who they are.',
  },
  {
    id: 'san',
    word: 'subject alternative name',
    definition:
      'The list of names a certificate is actually valid for. Browsers match the address against this list and ignore the older "common name" field entirely.',
  },
  {
    id: 'wildcard',
    word: 'wildcard',
    definition:
      'A name like *.example.com, which stands for exactly one label in that position -- so it covers www.example.com but not example.com itself, and not a.b.example.com.',
  },
  {
    id: 'handshake',
    word: 'handshake',
    definition:
      'The short conversation at the start of an HTTPS connection where both sides agree on keys and the server proves it holds the private key for its certificate. This lab does not run one.',
  },
  {
    id: 'sni',
    word: 'server name indication',
    definition:
      'A field in the very first message that tells the server which site you want, so it knows which certificate to send. It is sent before any encryption exists, which is why it is readable.',
  },
]

const byId = new Map(TERMS.map((t) => [t.id, t]))

export function term(id: string): Term {
  const t = byId.get(id)
  if (!t) throw new Error(`unknown glossary term: ${id}`)
  return t
}
