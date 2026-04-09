/**
 * XPath from `document` for `evaluate()` in the **page** JS realm (same node as content script).
 * Not used for shadow roots that are closed / not pierced from document.
 */

export function getXPathForNode(node: Node): string {
  if (node.nodeType === Node.DOCUMENT_NODE) return "/";
  if (node === document.documentElement) return "/html";
  if (node === document.body) return "/html/body";

  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent) return "";
    const textSiblings = [...parent.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE);
    const idx = textSiblings.indexOf(node as Text) + 1;
    if (idx < 1) return getXPathForNode(parent);
    return `${getXPathForNode(parent)}/text()[${idx}]`;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    const p = node.parentElement ?? node.parentNode;
    if (p) return getXPathForNode(p);
    return "";
  }

  const el = node as Element;
  // XPath 1.0 id() is not used; attribute match breaks on quotes — only use simple ids.
  if (el.id && /^[A-Za-z][\w-:.]*$/.test(el.id)) {
    return `//*[@id='${el.id}']`;
  }

  const parent = el.parentElement;
  if (!parent) return "";

  const tag = el.nodeName.toLowerCase();
  const sameTag = [...parent.children].filter((c) => c.nodeName === el.nodeName);
  const pos = sameTag.indexOf(el) + 1;
  if (pos < 1) return `${getXPathForNode(parent)}/${tag}[1]`;

  return `${getXPathForNode(parent)}/${tag}[${pos}]`;
}
