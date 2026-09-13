#!/usr/bin/env node
// Proves this repository shares no copied prose with an external skill corpus.
//
// Salesforce publishes forcedotcom/sf-skills under Apache-2.0 while its npm package declares
// CC-BY-NC-4.0 for the same `skills/` tree (docs/salesforce-skills.md). vibe-force therefore
// links to it and never copies from it. This script turns that promise into an exit code:
// every 8-word prose sequence in skills/**/*.md is checked against the corpus.
//
//   node scripts/dev/skill-originality.mjs --corpus /tmp/sf-skills
//
// Exit 0 pass or skipped, 1 shared sequences found, 2 corpus path unusable.
//
// Fenced code blocks and inline code are excluded by default: an `sf` command, a metadata type
// name or an Apex signature is a fact, and facts are not copyrightable. Pass --include-code to
// compare them too.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SHINGLE = 8;

function parseArgs(argv) {
  const opts = {
    corpus: null,
    json: false,
    shingle: SHINGLE,
    includeCode: false,
    dir: 'skills',
    allow: 'scripts/dev/originality-allow.txt'
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--corpus') opts.corpus = argv[++i];
    else if (arg === '--dir') opts.dir = argv[++i];
    else if (arg === '--shingle') opts.shingle = Number(argv[++i]);
    else if (arg === '--allow') opts.allow = argv[++i];
    else if (arg === '--json') opts.json = true;
    else if (arg === '--include-code') opts.includeCode = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else return { error: `unknown argument: ${arg}` };
  }
  if (!Number.isInteger(opts.shingle) || opts.shingle < 4) {
    return { error: '--shingle must be an integer >= 4' };
  }
  return opts;
}

function markdownFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

// Returns tokens as [word, line] pairs, with code stripped unless includeCode.
function tokenize(text, includeCode) {
  const tokens = [];
  let inFence = false;
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n += 1) {
    let line = lines[n];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence && !includeCode) continue;
    if (!includeCode) line = line.replace(/`[^`]*`/g, ' ');
    const words = line.toLowerCase().match(/[a-z0-9]+(?:[._/-][a-z0-9]+)*/g);
    if (!words) continue;
    for (const word of words) tokens.push([word, n + 1]);
  }
  return tokens;
}

// Two independent hashes packed into one safe integer: 32 bits of FNV-1a, 21 bits of djb2.
// 2^53 keyspace keeps false positives below 1e-4 over a corpus of a few million shingles.
function hashShingle(words) {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (const word of words) {
    for (let i = 0; i < word.length; i += 1) {
      const code = word.charCodeAt(i);
      fnv = Math.imul(fnv ^ code, 0x01000193);
      djb = (Math.imul(djb, 33) + code) | 0;
    }
    fnv = Math.imul(fnv ^ 0x20, 0x01000193);
    djb = (Math.imul(djb, 33) + 0x20) | 0;
  }
  return (fnv >>> 0) * 2097152 + (djb >>> 11 & 0x1fffff);
}

function shingles(tokens, size) {
  const out = [];
  for (let i = 0; i + size <= tokens.length; i += 1) {
    const slice = tokens.slice(i, i + size);
    out.push({ hash: hashShingle(slice.map((t) => t[0])), line: slice[0][1], text: slice.map((t) => t[0]).join(' ') });
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.error) {
  process.stderr.write(`${opts.error}\n`);
  process.exit(2);
}
if (opts.help) {
  process.stdout.write(
    'usage: skill-originality.mjs --corpus <dir> [--dir skills] [--shingle 8]\n' +
      '                            [--allow <file>] [--include-code] [--json]\n'
  );
  process.exit(0);
}

// Allowlist entries are maximal factual phrases - published limits, severity scales, official
// document titles with their URL. A hit is suppressed when it falls inside one. Every entry is a
// reviewed decision that the overlap is a fact rather than an expression; keep the comment.
function loadAllow(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

const repoRoot = resolve(process.cwd());
const ownFiles = markdownFiles(resolve(repoRoot, opts.dir));

if (!opts.corpus) {
  const report = { check: 'originality', status: 'skipped', reason: 'no --corpus given', files: ownFiles.length };
  process.stdout.write(
    opts.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `originality: skipped (${ownFiles.length} files, no --corpus given)\n` +
          'clone the corpus and re-run: git clone --depth 1 https://github.com/forcedotcom/sf-skills /tmp/sf-skills\n'
  );
  process.exit(0);
}

const corpusRoot = resolve(opts.corpus);
try {
  if (!statSync(corpusRoot).isDirectory()) throw new Error('not a directory');
} catch (err) {
  process.stderr.write(`corpus unusable: ${corpusRoot} (${err.message})\n`);
  process.exit(2);
}

const corpusFiles = markdownFiles(corpusRoot);
if (corpusFiles.length === 0) {
  process.stderr.write(`corpus contains no markdown: ${corpusRoot}\n`);
  process.exit(2);
}

const corpus = new Set();
for (const file of corpusFiles) {
  const tokens = tokenize(readFileSync(file, 'utf8'), opts.includeCode);
  for (const s of shingles(tokens, opts.shingle)) corpus.add(s.hash);
}

const allow = loadAllow(resolve(repoRoot, opts.allow));
const hits = [];
let allowed = 0;
for (const file of ownFiles) {
  const tokens = tokenize(readFileSync(file, 'utf8'), opts.includeCode);
  for (const s of shingles(tokens, opts.shingle)) {
    if (!corpus.has(s.hash)) continue;
    if (allow.some((phrase) => phrase.includes(s.text))) {
      allowed += 1;
      continue;
    }
    hits.push({ file: relative(repoRoot, file), line: s.line, text: s.text });
  }
}

const report = {
  check: 'originality',
  status: hits.length === 0 ? 'pass' : 'fail',
  shingle: opts.shingle,
  includeCode: opts.includeCode,
  corpus: { root: corpusRoot, files: corpusFiles.length, shingles: corpus.size },
  scanned: { root: opts.dir, files: ownFiles.length },
  allowed,
  hits
};

if (opts.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else if (hits.length === 0) {
  process.stdout.write(
    `originality: pass (${ownFiles.length} files vs ${corpusFiles.length} corpus files, ` +
      `${corpus.size} corpus shingles of ${opts.shingle} words, ${allowed} allowlisted)\n`
  );
} else {
  for (const hit of hits.slice(0, 50)) {
    process.stdout.write(`${hit.file}:${hit.line}: shared with corpus: "${hit.text}"\n`);
  }
  if (hits.length > 50) process.stdout.write(`... and ${hits.length - 50} more\n`);
  process.stdout.write(`originality: fail (${hits.length} shared sequences)\n`);
}

process.exit(hits.length === 0 ? 0 : 1);
