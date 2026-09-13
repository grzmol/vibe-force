#!/usr/bin/env node
'use strict';
/**
 * vibe-force metadata XML tool.
 *
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/vf-xml.js" <command> <file> [selector] [options]
 *
 * Reads and patches Salesforce metadata without loading whole files into a
 * session. `outline` answers "what is in here" in tens of tokens; `get` returns
 * one subtree; `set`/`replace`/`insert`/`remove` splice byte ranges so the file
 * stays byte-identical outside the range addressed.
 *
 * Exit codes: 0 done, 1 selector matched nothing or the result would be
 * malformed, 2 misuse or unreadable file.
 *
 * Zero npm dependencies: node: builtins only, Node 20 or later.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const xn = require('./lib/xml-nodes');
const { lintXml } = require('./lib/xml-lint');

const EXIT = { OK: 0, FAILED: 1, MISUSE: 2 };

const USAGE = `vf-xml - read and patch Salesforce metadata XML without burning tokens

  outline <file> [--depth N] [--max-ids N]   structure only: child names, counts, identities
  get     <file> <selector>                  print every matching element
  set     <file> <selector> --value <text>   replace the text of matching leaf elements
  replace <file> <selector> --xml <xml>      replace whole matching elements
  insert  <file> <selector> --xml <xml> [--where before|after|firstChild|lastChild]
  remove  <file> <selector>                  delete matching elements
  stats   <file...>                          bytes and estimated tokens, largest last

Selectors
  Flow/status                                anchored path from the document root
  //fieldPermissions                         any depth
  Workflow/rules[2]                          0-based ordinal among same-name siblings
  //fieldUpdates[fullName=SetHigh]/field     predicate on any step

Options
  --xml-file <path>  read the replacement/inserted XML from a file instead of --xml
  --stdout           print the patched document instead of writing it back
  --json             machine-readable result
`;

const OPTIONS = {
  depth: { type: 'string' },
  'max-ids': { type: 'string' },
  value: { type: 'string' },
  xml: { type: 'string' },
  'xml-file': { type: 'string' },
  where: { type: 'string', default: 'after' },
  stdout: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false }
};

function fail(code, message) {
  process.stderr.write(`vf-xml: ${message}\n`);
  process.exit(code);
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail(EXIT.MISUSE, `cannot read ${file}: ${err.message}`);
  }
}

function replacementXml(values) {
  if (values['xml-file']) return read(values['xml-file']).trim();
  if (typeof values.xml === 'string') return values.xml;
  fail(EXIT.MISUSE, 'this command needs --xml <xml> or --xml-file <path>');
}

/** Never write a document this tool just broke. */
function commit(file, text, changed, values, command) {
  const lint = lintXml(text);
  if (!lint.ok) fail(EXIT.FAILED, `${command} would leave ${path.basename(file)} malformed: ${lint.errors.join('; ')} - nothing written`);
  if (values.stdout) process.stdout.write(text);
  else fs.writeFileSync(file, text);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (values.json) process.stdout.write(`${JSON.stringify({ command, file, changed, bytes, written: !values.stdout })}\n`);
  else if (!values.stdout) process.stdout.write(`${command}: ${changed} node(s) in ${file}\n`);
  process.exit(changed ? EXIT.OK : EXIT.FAILED);
}

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    fail(EXIT.MISUSE, err.message);
  }
  const { values, positionals } = parsed;
  const [command, file, selector] = positionals;
  if (values.help || !command) {
    process.stdout.write(USAGE);
    process.exit(values.help ? EXIT.OK : EXIT.MISUSE);
  }

  if (command === 'stats') {
    const files = positionals.slice(1);
    if (!files.length) fail(EXIT.MISUSE, 'stats needs at least one file');
    const rows = files
      .map((f) => {
        let bytes = 0;
        try {
          bytes = fs.statSync(f).size;
        } catch (err) {
          return { file: f, bytes: 0, tokens: 0, error: err.code };
        }
        return { file: f, bytes, tokens: xn.estimateTokens(bytes) };
      })
      .sort((a, b) => a.bytes - b.bytes);
    if (values.json) process.stdout.write(`${JSON.stringify({ files: rows, totalTokens: rows.reduce((s, r) => s + r.tokens, 0) }, null, 2)}\n`);
    else {
      for (const r of rows) process.stdout.write(`${String(r.tokens).padStart(8)} tok  ${String(r.bytes).padStart(9)} B  ${r.file}${r.error ? `  (${r.error})` : ''}\n`);
      process.stdout.write(`${String(rows.reduce((s, r) => s + r.tokens, 0)).padStart(8)} tok  total across ${rows.length} file(s)\n`);
    }
    process.exit(EXIT.OK);
  }

  if (!file) fail(EXIT.MISUSE, `${command} needs a file`);
  const source = read(file);

  if (command === 'outline') {
    const text = xn.outline(source, {
      depth: values.depth ? Number(values.depth) : undefined,
      maxIds: values['max-ids'] ? Number(values['max-ids']) : undefined
    });
    process.stdout.write(values.json ? `${JSON.stringify({ file, outline: text })}\n` : `${text}\n`);
    process.exit(EXIT.OK);
  }

  if (!selector) fail(EXIT.MISUSE, `${command} needs a selector`);

  try {
    if (command === 'get') {
      const hits = xn.get(source, selector);
      if (values.json) process.stdout.write(`${JSON.stringify({ file, selector, matches: hits.length, nodes: hits })}\n`);
      else for (const h of hits) process.stdout.write(`${h}\n`);
      process.exit(hits.length ? EXIT.OK : EXIT.FAILED);
    }
    if (command === 'set') {
      if (typeof values.value !== 'string') fail(EXIT.MISUSE, 'set needs --value <text>');
      const r = xn.setText(source, selector, values.value);
      commit(file, r.text, r.changed, values, 'set');
    }
    if (command === 'replace') {
      const r = xn.replaceNodes(source, selector, replacementXml(values));
      commit(file, r.text, r.changed, values, 'replace');
    }
    if (command === 'insert') {
      const r = xn.insert(source, selector, replacementXml(values), values.where);
      commit(file, r.text, r.changed, values, 'insert');
    }
    if (command === 'remove') {
      const r = xn.remove(source, selector);
      commit(file, r.text, r.changed, values, 'remove');
    }
  } catch (err) {
    fail(EXIT.MISUSE, err.message);
  }

  fail(EXIT.MISUSE, `unknown command "${command}"\n\n${USAGE}`);
}

main(process.argv.slice(2));
