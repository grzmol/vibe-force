#!/usr/bin/env node
// Checks every metadata directory the hooks route on against Salesforce's own registry.
//
// `scripts/lib/sf-paths.js` decides which agent owns a file by matching directory names. A name
// that does not exist - `externalServices/` instead of `externalServiceRegistrations/` - matches
// nothing, so the path silently has no owner and the collision guard has nothing to enforce.
//
// Source of truth: src/registry/metadataRegistry.json in forcedotcom/source-deploy-retrieve, the
// registry the Salesforce CLI itself deploys with. Nothing from it is copied into this repository;
// it is read at check time.
//
//   node scripts/dev/verify-metadata-dirs.mjs                        # fetches the registry
//   node scripts/dev/verify-metadata-dirs.mjs --registry <file|dir>  # local clone or JSON file
//
// Exit 0 pass or skipped (registry unreachable), 1 an unknown or unmirrored directory, 2 the
// given registry path is unusable.

import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REGISTRY_URL =
  'https://raw.githubusercontent.com/forcedotcom/source-deploy-retrieve/main/src/registry/metadataRegistry.json';
const SLICE_SOURCE = 'scripts/lib/sf-paths.js';
const MIRROR = 'skills/sf-workflow-orchestration/references/ownership-matrix.md';

const args = process.argv.slice(2);
let registryArg = null;
let json = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--registry') registryArg = args[++i];
  else if (args[i] === '--json') json = true;
  else if (args[i] === '--help' || args[i] === '-h') {
    process.stdout.write('usage: verify-metadata-dirs.mjs [--registry <file|dir>] [--json]\n');
    process.exit(0);
  } else {
    process.stderr.write(`unknown argument: ${args[i]}\n`);
    process.exit(2);
  }
}

function readLocalRegistry(target) {
  let stat;
  try {
    stat = statSync(target);
  } catch (err) {
    process.stderr.write(`registry unusable: ${target} (${err.message})\n`);
    process.exit(2);
  }
  const file = stat.isDirectory() ? join(target, 'src/registry/metadataRegistry.json') : target;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    process.stderr.write(`registry unusable: ${file} (${err.message})\n`);
    process.exit(2);
  }
}

async function loadRegistry() {
  if (registryArg) return { registry: readLocalRegistry(resolve(registryArg)), origin: registryArg };
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { registry: await res.json(), origin: REGISTRY_URL };
  } catch (err) {
    return { registry: null, reason: err.message };
  }
}

function registryDirectories(registry) {
  const dirs = new Set();
  for (const type of Object.values(registry.types ?? {})) {
    if (type.directoryName) dirs.add(type.directoryName);
    for (const child of Object.values(type.children?.types ?? {})) {
      if (child.directoryName) dirs.add(child.directoryName);
    }
  }
  return dirs;
}

// Directory tokens as written in the SLICES regexes: /\/namedCredentials\//
function sliceDirectories(source) {
  const slices = [];
  const sliceBlock = /(\w+):\s*\{\s*agent:\s*'([^']+)'([\s\S]*?)\n {2}\}/g;
  let match;
  while ((match = sliceBlock.exec(source)) !== null) {
    const dirs = [...match[3].matchAll(/\/\\\/([A-Za-z]+)\\\//g)].map((m) => m[1]);
    slices.push({ slice: match[1], agent: match[2], dirs });
  }
  return slices;
}

const repoRoot = resolve(process.cwd());
const source = readFileSync(join(repoRoot, SLICE_SOURCE), 'utf8');
const slices = sliceDirectories(source);
const mirror = readFileSync(join(repoRoot, MIRROR), 'utf8');

// Directories that are source folders rather than metadata types: the registry does not name them.
const NOT_METADATA_DIRS = new Set(['classes', 'triggers']);

const { registry, origin, reason } = await loadRegistry();
const problems = [];

if (registry) {
  const known = registryDirectories(registry);
  const lower = new Map([...known].map((d) => [d.toLowerCase(), d]));
  for (const { slice, dirs } of slices) {
    for (const dir of dirs) {
      if (known.has(dir) || NOT_METADATA_DIRS.has(dir)) continue;
      const suggestion = lower.get(dir.toLowerCase());
      problems.push({
        kind: 'unknown-directory',
        slice,
        dir,
        detail: suggestion ? `registry spells it ${suggestion}` : 'no such directory in the registry'
      });
    }
  }
}

for (const { slice, dirs } of slices) {
  for (const dir of dirs) {
    if (NOT_METADATA_DIRS.has(dir)) continue;
    if (!mirror.includes(`${dir}/`)) {
      problems.push({ kind: 'unmirrored-directory', slice, dir, detail: `missing from ${MIRROR}` });
    }
  }
}

const report = {
  check: 'metadata-dirs',
  status: problems.length === 0 ? (registry ? 'pass' : 'skipped') : 'fail',
  registry: registry ? origin : null,
  skippedReason: registry ? null : `registry unreachable: ${reason}`,
  slices: slices.map((s) => ({ slice: s.slice, agent: s.agent, directories: s.dirs.length })),
  problems
};

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else if (problems.length === 0) {
  const counted = slices.reduce((n, s) => n + s.dirs.length, 0);
  process.stdout.write(
    registry
      ? `metadata-dirs: pass (${counted} directories in ${slices.length} slices, registry ${origin})\n`
      : `metadata-dirs: skipped (registry unreachable: ${reason}); mirror check passed\n`
  );
} else {
  for (const p of problems) {
    process.stdout.write(`${SLICE_SOURCE}: slice ${p.slice}: ${p.dir}/ - ${p.detail}\n`);
  }
  process.stdout.write(`metadata-dirs: fail (${problems.length} problems)\n`);
}

process.exit(problems.length === 0 ? 0 : 1);
