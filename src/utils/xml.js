export function findFirstByLocalName(node, name) {
  if (!node) return null;
  const target = name.toLowerCase();
  if (node.localName && node.localName.toLowerCase() === target) return node;
  const children = node.childNodes || [];
  for (let i = 0; i < children.length; i += 1) {
    const found = findFirstByLocalName(children[i], name);
    if (found) return found;
  }
  return null;
}

export function getTextByLocalNames(node, names) {
  for (const name of names) {
    const found = findFirstByLocalName(node, name);
    if (found && found.textContent !== undefined) {
      const text = String(found.textContent || "").trim();
      if (text) return text;
    }
  }
  return null;
}
