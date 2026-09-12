'use strict';
/**
 * Dependency-free well-formedness check for Salesforce metadata XML.
 *
 * Not a validating parser: it catches the failures that actually happen when an
 * agent hand-edits metadata (unclosed tag, mismatched nesting, stray `&`,
 * missing declaration, duplicate root) before the deploy round trip does.
 */

const VOID_OK = new Set(['?xml', '!DOCTYPE']);

function lintXml(source) {
  const errors = [];
  const text = String(source || '');
  if (!text.trim()) return { ok: false, errors: ['file is empty'] };

  if (!/^\uFEFF?\s*<\?xml\s/.test(text)) errors.push('missing XML declaration (`<?xml version="1.0" encoding="UTF-8"?>`)');

  const stack = [];
  const tagRe = /<(\/?)([A-Za-z_?!][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;
  let match;
  let roots = 0;
  while ((match = tagRe.exec(text)) !== null) {
    const [, closing, name, , selfClosing] = match;
    if (VOID_OK.has(name)) continue;
    if (closing) {
      const open = stack.pop();
      if (!open) errors.push(`closing tag </${name}> without a matching opening tag`);
      else if (open !== name) errors.push(`closing tag </${name}> does not match open tag <${open}>`);
      if (stack.length === 0) roots += 1;
    } else if (!selfClosing) {
      stack.push(name);
    } else if (stack.length === 0) {
      roots += 1;
    }
  }
  if (stack.length) errors.push(`unclosed tag(s): ${stack.slice(-3).join(', ')}`);
  if (roots > 1) errors.push(`${roots} root elements; metadata files carry exactly one`);

  const withoutTags = text.replace(tagRe, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const badAmp = withoutTags.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9A-Fa-f]+;)/);
  if (badAmp) errors.push('unescaped `&` in text content (use `&amp;`)');

  return { ok: errors.length === 0, errors };
}

/** Extract `<apiVersion>` if present. */
function apiVersionOf(source) {
  const m = String(source || '').match(/<apiVersion>\s*([\d.]+)\s*<\/apiVersion>/);
  return m ? m[1] : null;
}

module.exports = { lintXml, apiVersionOf };
