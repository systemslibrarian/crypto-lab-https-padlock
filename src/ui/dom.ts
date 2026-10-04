/**
 * A small element builder.
 *
 * Deliberately not a framework: the page's whole job is to render one
 * Assessment object, and a 40-line helper keeps every attribute the a11y gate
 * cares about -- role, aria-label, tabindex, data-verdict -- visible at the
 * point it is set, rather than hidden in a template string where a missing
 * `role="listitem"` is invisible on review.
 */

type Attrs = Record<string, string | number | boolean | undefined>

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue
    if (k === 'class') node.className = String(v)
    else if (k === 'text') node.textContent = String(v)
    else node.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c)
  return node
}

/** Replace a container's contents in one go. */
export function fill(host: Element, ...children: (Node | string)[]): void {
  host.replaceChildren(...children)
}

/**
 * A list with its semantics made explicit.
 *
 * Every list on this page is styled with `list-style: none`, which is exactly
 * the declaration that makes Safari and VoiceOver drop a list's implicit role.
 * So the role is stated, and `listitem` on every child -- and because an empty
 * `role="list"` fails axe's `aria-required-children`, this refuses to build one.
 */
export function list(attrs: Attrs, items: HTMLElement[]): HTMLElement {
  if (items.length === 0) throw new Error('refusing to render an empty role="list"')
  const ul = el('ul', { ...attrs, role: 'list' })
  for (const item of items) {
    item.setAttribute('role', 'listitem')
    ul.append(item)
  }
  return ul
}

/**
 * An inline definition: a real button plus a panel, never a hover tooltip.
 *
 * A hover tooltip is unreachable by keyboard and by touch, and WCAG 1.4.13
 * then requires it to be dismissable, hoverable and persistent -- three rules
 * to get wrong for no gain over a button that already announces its state.
 */
export function defineTerm(word: string, definition: string, key: string): HTMLElement {
  const panelId = `def-${key}`
  const btn = el('button', {
    type: 'button',
    class: 'define',
    'aria-expanded': 'false',
    'aria-controls': panelId,
  }, [document.createTextNode(word)])
  const panel = el('span', { class: 'define-panel', id: panelId, role: 'note', hidden: true }, [
    document.createTextNode(definition),
  ])
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') === 'true'
    btn.setAttribute('aria-expanded', String(!open))
    panel.hidden = open
  })
  return el('span', { class: 'define-wrap' }, [btn, panel])
}
