/**
 * Target-file selection.
 *
 * `--files <glob,...>` matches globs against the project tree, `--changed` delegates to git, and
 * with neither flag the target is every package directory. Globbing is implemented here rather
 * than with `fs.globSync` so the runner still works on Node 20.
 */

import fs from 'node:fs';
import path from 'node:path';
import { packageDirectories } from './config.mjs';
import { changedFiles } from './git.mjs';

const ALWAYS_PRUNED = new Set([
  'node_modules',
  '.git',
  '.sfdx',
  '.sf',
  '.vibeforce',
  '.localdevserver',
  'coverage',
  'dist',
  'build',
]);

/** Converts a glob to an anchored RegExp. Supports `*`, `?`, `**`, `{a,b}` and character classes. */
export function globToRegExp(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        const slashSuffix = glob[i + 2] === '/';
        out += slashSuffix ? '(?:.*/)?' : '.*';
        i += slashSuffix ? 2 : 1;
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else if (char === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) {
        out += '\\{';
      } else {
        const alternatives = glob
          .slice(i + 1, close)
          .split(',')
          .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'));
        out += `(?:${alternatives.join('|')})`;
        i = close;
      }
    } else if (char === '[') {
      const close = glob.indexOf(']', i);
      if (close === -1) {
        out += '\\[';
      } else {
        out += glob.slice(i, close + 1);
        i = close;
      }
    } else if ('.+^$()|\\'.includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return new RegExp(`${out}$`);
}

export function walk(root, { relativeTo = root, prune = ALWAYS_PRUNED, limit = 20000 } = {}) {
  const results = [];
  const stack = [root];
  while (stack.length > 0 && results.length < limit) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (prune.has(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        results.push(path.relative(relativeTo, full).split(path.sep).join('/'));
      }
    }
  }
  return results;
}

/**
 * @returns {Promise<{mode:'changed'|'files'|'all', files:string[], base?:string|null,
 *   warning?:string}>} project-relative POSIX paths.
 */
export async function resolveTargets(ctx) {
  const pkgDirs = packageDirectories(ctx);

  if (ctx.args.files) {
    const globs = String(ctx.args.files)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const patterns = globs.map(globToRegExp);
    const literal = globs.filter((value) => !/[*?{[]/.test(value));
    const tree = walk(ctx.projectRoot);
    const matched = tree.filter((file) => patterns.some((pattern) => pattern.test(file)));
    for (const file of literal) {
      const normalized = file.split(path.sep).join('/');
      if (!matched.includes(normalized) && fs.existsSync(path.join(ctx.projectRoot, normalized))) {
        matched.push(normalized);
      }
    }
    return { mode: 'files', files: [...new Set(matched)].sort() };
  }

  if (ctx.args.changed) {
    const result = await changedFiles(ctx);
    if (!result.ok) {
      return {
        mode: 'all',
        files: collectPackageFiles(ctx.projectRoot, pkgDirs),
        warning: `--changed ignored: ${result.reason}`,
      };
    }
    return { mode: 'changed', base: result.base, files: result.files };
  }

  return { mode: 'all', files: collectPackageFiles(ctx.projectRoot, pkgDirs) };
}

function collectPackageFiles(projectRoot, pkgDirs) {
  const files = [];
  for (const dir of pkgDirs) {
    const abs = path.join(projectRoot, dir);
    if (!fs.existsSync(abs)) continue;
    files.push(...walk(abs, { relativeTo: projectRoot }));
  }
  return files.sort();
}

export function byExtension(files, extensions) {
  const allowed = new Set(extensions.map((ext) => ext.toLowerCase()));
  return files.filter((file) => allowed.has(path.extname(file).toLowerCase()));
}

export function underAnyGlob(files, globs) {
  if (!globs || globs.length === 0) return files;
  const patterns = globs.map(globToRegExp);
  return files.filter((file) => patterns.some((pattern) => pattern.test(file)));
}

/** Metadata-type buckets used by pairing checks and deploy scoping. */
export function classify(files) {
  const apexClasses = [];
  const apexTriggers = [];
  const apexTests = [];
  const lwcModules = new Set();
  const lwcTests = [];
  const auraBundles = new Set();
  const metadata = [];

  for (const file of files) {
    const lower = file.toLowerCase();
    if (lower.endsWith('.cls')) {
      const base = path.basename(file, path.extname(file));
      if (/test/i.test(base)) apexTests.push(file);
      else apexClasses.push(file);
    } else if (lower.endsWith('.trigger')) {
      apexTriggers.push(file);
    } else if (lower.includes('/lwc/')) {
      const parts = file.split('/');
      const index = parts.lastIndexOf('lwc');
      const moduleName = parts[index + 1];
      if (moduleName) lwcModules.add(parts.slice(0, index + 2).join('/'));
      if (file.includes('/__tests__/')) lwcTests.push(file);
    } else if (lower.includes('/aura/')) {
      const parts = file.split('/');
      const index = parts.lastIndexOf('aura');
      if (parts[index + 1]) auraBundles.add(parts.slice(0, index + 2).join('/'));
    } else if (lower.endsWith('-meta.xml') || lower.endsWith('.xml')) {
      metadata.push(file);
    }
  }

  return {
    apexClasses,
    apexTriggers,
    apexTests,
    lwcModules: [...lwcModules].sort(),
    lwcTests,
    auraBundles: [...auraBundles].sort(),
    metadata,
  };
}

/** Deploy scoping: the smallest set of directories covering the given files. */
export function sourceDirsFor(files, pkgDirs) {
  const dirs = new Set();
  for (const file of files) {
    const parts = file.split('/');
    const lwcIndex = parts.lastIndexOf('lwc');
    const auraIndex = parts.lastIndexOf('aura');
    if (lwcIndex !== -1 && parts[lwcIndex + 1]) dirs.add(parts.slice(0, lwcIndex + 2).join('/'));
    else if (auraIndex !== -1 && parts[auraIndex + 1]) dirs.add(parts.slice(0, auraIndex + 2).join('/'));
    else dirs.add(parts.slice(0, -1).join('/'));
  }
  const inPackages = [...dirs].filter((dir) => pkgDirs.some((pkg) => dir === pkg || dir.startsWith(`${pkg}/`)));
  return inPackages.sort();
}
