'use strict';
/**
 * Byte-range node index for Salesforce metadata XML.
 *
 * Why byte ranges and not a DOM: a parse-then-reserialise round trip reformats
 * whole files, which turns a two-line permission change into a several-thousand
 * line diff and shifts Flow canvas coordinates. Every operation here slices or
 * splices the original string, so the file stays byte-identical outside the
 * range that was addressed.
 *
 * Why it exists at all: reading a profile or a flow into the model costs
 * thousands of tokens per file. `outline()` answers "what is in here" in tens of
 * tokens, `get()` returns one subtree, `replaceNodes()`/`setText()` edit without
 * ever loading the rest. See references/xml-token-economy.md.
 *
 * Well-formedness is not this module's job: run `xml-lint.lintXml()` first.
 */

const TAG_RE = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const SKIP_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/g;

/** Child elements that carry a node's identity, best first. */
const ID_CHILDREN = ['fullName', 'name', 'field', 'apiName', 'label', 'masterLabel'];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function escapeText(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function unescapeText(value) {
  return String(value == null ? '' : value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Ranges the tag scanner must not look inside (comments, CDATA, PI, doctype). */
function skipRanges(src) {
  const ranges = [];
  SKIP_RE.lastIndex = 0;
  let m;
  while ((m = SKIP_RE.exec(src)) !== null) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

/**
 * Index every element as a byte range.
 *
 * @param {string} text raw file contents
 * @returns {{src:string, nodes:Array, childrenOf:Map<number,number[]>}}
 */
function index(text) {
  const src = String(text == null ? '' : text);
  const skips = skipRanges(src);
  let skipAt = 0;
  const inSkip = (i) => {
    while (skipAt < skips.length && skips[skipAt][1] <= i) skipAt += 1;
    return skipAt < skips.length && i >= skips[skipAt][0] && i < skips[skipAt][1];
  };

  const nodes = [];
  const stack = [];
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(src)) !== null) {
    if (inSkip(m.index)) continue;
    const raw = m[0];
    const closing = Boolean(m[1]);
    const name = m[2];
    const selfClosing = Boolean(m[4]);

    if (closing) {
      const idx = stack.pop();
      if (idx === undefined) continue;
      nodes[idx].innerEnd = m.index;
      nodes[idx].end = m.index + raw.length;
      if (nodes[idx].name !== name) nodes[idx].mismatch = name;
      continue;
    }

    const parent = stack.length ? stack[stack.length - 1] : -1;
    nodes.push({
      name,
      parent,
      depth: stack.length,
      start: m.index,
      innerStart: m.index + raw.length,
      innerEnd: selfClosing ? m.index : -1,
      end: selfClosing ? m.index + raw.length : -1,
      selfClosing
    });
    if (!selfClosing) stack.push(nodes.length - 1);
  }
  // Unclosed tags: treat the rest of the file as their content. lintXml reports them.
  while (stack.length) {
    const idx = stack.pop();
    nodes[idx].innerEnd = src.length;
    nodes[idx].end = src.length;
    nodes[idx].unclosed = true;
  }

  const childrenOf = new Map();
  const counters = new Map();
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    n.path = n.parent === -1 ? n.name : `${nodes[n.parent].path}/${n.name}`;
    const key = `${n.parent}:${n.name}`;
    n.ordinal = counters.get(key) || 0;
    counters.set(key, n.ordinal + 1);
    if (!childrenOf.has(n.parent)) childrenOf.set(n.parent, []);
    childrenOf.get(n.parent).push(i);
  }
  return { src, nodes, childrenOf };
}

/** Raw text between a node's tags. */
function innerText(doc, node) {
  return doc.src.slice(node.innerStart, node.innerEnd);
}

/** Decoded text of a leaf node, or '' when it has element children. */
function leafValue(doc, nodeIndex) {
  const kids = doc.childrenOf.get(nodeIndex) || [];
  if (kids.length) return '';
  return unescapeText(innerText(doc, doc.nodes[nodeIndex]).trim());
}

/** First identity-bearing child value, for outlines and predicates. */
function identityOf(doc, nodeIndex) {
  const kids = doc.childrenOf.get(nodeIndex) || [];
  for (const wanted of ID_CHILDREN) {
    for (const k of kids) if (doc.nodes[k].name === wanted) return leafValue(doc, k);
  }
  return '';
}

/**
 * Selector grammar, deliberately small:
 *   Flow/status              anchored element path from the root
 *   //fieldPermissions       any depth, matches a path suffix
 *   Workflow/rules[2]        0-based ordinal among same-name siblings
 *   //fieldPermissions[field=Account.Rating]/editable   child equal to a value
 * A predicate may sit on any step, which is what makes "address the node by its
 * identity, then take one field inside it" a single call.
 */
function parseSelector(selector) {
  const raw = String(selector == null ? '' : selector).trim();
  if (!raw) throw new Error('empty selector');
  const anchored = !raw.startsWith('//');
  const parts = (anchored ? raw : raw.slice(2)).split('/').filter(Boolean);
  if (!parts.length) throw new Error(`selector has no element names: ${raw}`);

  const steps = parts.map((part) => {
    const m = part.match(/^([A-Za-z_][\w.:-]*)(?:\[([^\]]+)\])?$/);
    if (!m) throw new Error(`bad selector step "${part}" in ${raw}`);
    if (!m[2]) return { name: m[1], predicate: null };
    const body = m[2].trim();
    if (/^\d+$/.test(body)) return { name: m[1], predicate: { kind: 'ordinal', value: Number(body) } };
    const kv = body.match(/^([A-Za-z_][\w.:-]*)\s*=\s*(.*)$/);
    if (!kv) throw new Error(`bad predicate "[${body}]" in ${raw}`);
    return { name: m[1], predicate: { kind: 'child', child: kv[1], value: kv[2].replace(/^['"]|['"]$/g, '') } };
  });
  return { anchored, steps, raw };
}

function predicateHit(doc, nodeIndex, predicate) {
  if (predicate.kind === 'ordinal') return doc.nodes[nodeIndex].ordinal === predicate.value;
  const kids = doc.childrenOf.get(nodeIndex) || [];
  return kids.some((k) => doc.nodes[k].name === predicate.child && leafValue(doc, k) === predicate.value);
}

/** Walk a node's ancestor chain against the selector steps, right to left. */
function matchesSelector(doc, nodeIndex, sel) {
  let idx = nodeIndex;
  for (let s = sel.steps.length - 1; s >= 0; s -= 1) {
    if (idx === -1) return false;
    const step = sel.steps[s];
    if (doc.nodes[idx].name !== step.name) return false;
    if (step.predicate && !predicateHit(doc, idx, step.predicate)) return false;
    idx = doc.nodes[idx].parent;
  }
  return sel.anchored ? idx === -1 : true;
}

/** Node indices matching a selector, in document order. */
function select(doc, selector) {
  const sel = typeof selector === 'string' ? parseSelector(selector) : selector;
  const out = [];
  for (let i = 0; i < doc.nodes.length; i += 1) if (matchesSelector(doc, i, sel)) out.push(i);
  return out;
}

/** Raw XML of every match, whole element including its tags. */
function get(text, selector) {
  const doc = index(text);
  return select(doc, selector).map((i) => doc.src.slice(doc.nodes[i].start, doc.nodes[i].end));
}

/** Splice ranges right to left so earlier offsets stay valid. */
function spliceAll(src, edits) {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/** Leading whitespace of the line a node starts on. */
function indentOf(src, start) {
  const lineStart = src.lastIndexOf('\n', start - 1) + 1;
  const prefix = src.slice(lineStart, start);
  return /^\s*$/.test(prefix) ? prefix : '';
}

/** Replace whole matched elements with new XML. */
function replaceNodes(text, selector, xml) {
  const doc = index(text);
  const hits = select(doc, selector);
  if (!hits.length) return { text: doc.src, changed: 0 };
  const edits = hits.map((i) => ({ start: doc.nodes[i].start, end: doc.nodes[i].end, text: String(xml) }));
  return { text: spliceAll(doc.src, edits), changed: hits.length };
}

/** Replace the text content of matched leaf elements, escaping as needed. */
function setText(text, selector, value) {
  const doc = index(text);
  const hits = select(doc, selector);
  const edits = [];
  for (const i of hits) {
    const n = doc.nodes[i];
    if (n.selfClosing) {
      edits.push({ start: n.start, end: n.end, text: `<${n.name}>${escapeText(value)}</${n.name}>` });
      continue;
    }
    if ((doc.childrenOf.get(i) || []).length) throw new Error(`${n.path} has element children; use replace, not set`);
    edits.push({ start: n.innerStart, end: n.innerEnd, text: escapeText(value) });
  }
  return { text: spliceAll(doc.src, edits), changed: hits.length };
}

/** Remove matched elements together with the blank line they leave behind. */
function remove(text, selector) {
  const doc = index(text);
  const hits = select(doc, selector);
  const edits = hits.map((i) => {
    const n = doc.nodes[i];
    const lineStart = doc.src.lastIndexOf('\n', n.start - 1) + 1;
    const onlyIndentBefore = /^\s*$/.test(doc.src.slice(lineStart, n.start));
    const after = doc.src.slice(n.end).match(/^[ \t]*\r?\n/);
    return {
      start: onlyIndentBefore ? lineStart : n.start,
      end: n.end + (onlyIndentBefore && after ? after[0].length : 0),
      text: ''
    };
  });
  return { text: spliceAll(doc.src, edits), changed: hits.length };
}

/**
 * Insert XML relative to matched elements.
 * @param {'before'|'after'|'firstChild'|'lastChild'} where
 */
function insert(text, selector, xml, where = 'after') {
  const doc = index(text);
  const hits = select(doc, selector);
  const body = String(xml).trim();
  const edits = [];
  for (const i of hits) {
    const n = doc.nodes[i];
    if (where === 'before' || where === 'after') {
      const indent = indentOf(doc.src, n.start);
      const at = where === 'before' ? n.start : n.end;
      const block = where === 'before' ? `${body}\n${indent}` : `\n${indent}${body}`;
      edits.push({ start: at, end: at, text: block });
      continue;
    }
    if (n.selfClosing) throw new Error(`${n.path} is self-closing; nothing to insert into`);
    const kids = doc.childrenOf.get(i) || [];
    const ref = kids.length ? doc.nodes[where === 'firstChild' ? kids[0] : kids[kids.length - 1]] : null;
    const indent = ref ? indentOf(doc.src, ref.start) : `${indentOf(doc.src, n.start)}    `;
    const at = where === 'firstChild' ? (ref ? ref.start : n.innerStart) : ref ? ref.end : n.innerStart;
    const block = where === 'firstChild' && ref ? `${body}\n${indent}` : `\n${indent}${body}`;
    edits.push({ start: at, end: at, text: where === 'firstChild' && ref ? block : block });
  }
  return { text: spliceAll(doc.src, edits), changed: hits.length };
}

/** Rough token cost of a string. Bytes per token is ~3.5 for metadata XML. */
function estimateTokens(bytes) {
  return Math.round(bytes / 3.5);
}

/**
 * Compact structural summary: what is in the file, without its contents.
 *
 * @param {string} text
 * @param {{depth?:number, maxIds?:number}} [opts]
 * @returns {string}
 */
function outline(text, opts = {}) {
  const depth = Number.isInteger(opts.depth) ? opts.depth : 2;
  const maxIds = Number.isInteger(opts.maxIds) ? opts.maxIds : 12;
  const doc = index(text);
  if (!doc.nodes.length) return 'no elements';

  const lines = [];
  const roots = doc.childrenOf.get(-1) || [];
  for (const r of roots) {
    const n = doc.nodes[r];
    const bytes = n.end - n.start;
    lines.push(`${n.name}  ${bytes} B  ~${estimateTokens(bytes)} tok`);
    walk(r, 1);
  }

  function walk(parentIndex, level) {
    if (level > depth) return;
    const kids = doc.childrenOf.get(parentIndex) || [];
    const groups = new Map();
    for (const k of kids) {
      if (!groups.has(doc.nodes[k].name)) groups.set(doc.nodes[k].name, []);
      groups.get(doc.nodes[k].name).push(k);
    }
    const pad = '  '.repeat(level);
    for (const [name, members] of groups) {
      const ids = members.map((k) => identityOf(doc, k)).filter(Boolean);
      const leaf = members.length === 1 && !(doc.childrenOf.get(members[0]) || []).length;
      if (leaf) {
        const v = leafValue(doc, members[0]);
        lines.push(`${pad}${name}: ${v.length > 60 ? `${v.slice(0, 57)}...` : v}`);
        continue;
      }
      const shown = ids.slice(0, maxIds).join(', ');
      const more = ids.length > maxIds ? `, +${ids.length - maxIds} more` : '';
      const tail = ids.length ? `  [${shown}${more}]` : '';
      lines.push(`${pad}${name} x${members.length}${tail}`);
      if (members.length === 1) walk(members[0], level + 1);
    }
  }

  return lines.join('\n');
}

module.exports = {
  ID_CHILDREN,
  escapeText,
  unescapeText,
  index,
  select,
  parseSelector,
  innerText,
  leafValue,
  identityOf,
  get,
  replaceNodes,
  setText,
  remove,
  insert,
  outline,
  estimateTokens
};
