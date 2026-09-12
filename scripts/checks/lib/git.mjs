/**
 * Changed-file discovery for `--changed`.
 *
 * Baseline resolution:
 *   1. `git merge-base <config.git.baseRef> HEAD` (default base ref `origin/main`)
 *   2. `git merge-base <config.git.fallbackRef> HEAD` (default `HEAD~1`)
 *   3. no baseline: working tree only
 * The working tree (staged, unstaged and untracked) is always added on top unless
 * `config.git.includeWorkingTree` is false, so a check run before committing still sees the edits.
 */

import fs from 'node:fs';
import path from 'node:path';
import { exec, isToolMissing, resolveBin } from './run.mjs';

async function git(ctx, args) {
  return exec(resolveBin(ctx.config, 'git'), args, {
    cwd: ctx.projectRoot,
    env: ctx.env,
    timeoutMs: 30000,
  });
}

function splitLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function isRepo(ctx) {
  const res = await git(ctx, ['rev-parse', '--is-inside-work-tree']);
  if (isToolMissing(res)) return { ok: false, toolMissing: true };
  return { ok: res.code === 0 && res.stdout.trim() === 'true', toolMissing: false };
}

async function mergeBase(ctx, ref) {
  const res = await git(ctx, ['merge-base', ref, 'HEAD']);
  if (res.code !== 0) return null;
  const sha = res.stdout.trim();
  return sha.length > 0 ? sha : null;
}

/**
 * @returns {Promise<{ok:boolean,reason?:string,toolMissing?:boolean,base:string|null,
 *   files:string[]}>} `files` are project-relative POSIX paths that exist on disk.
 */
export async function changedFiles(ctx) {
  const repo = await isRepo(ctx);
  if (repo.toolMissing) {
    return { ok: false, toolMissing: true, reason: 'git is not installed', base: null, files: [] };
  }
  if (!repo.ok) {
    return { ok: false, reason: `${ctx.projectRoot} is not a git work tree`, base: null, files: [] };
  }

  const gitConfig = ctx.config.git ?? {};
  const baseRef = ctx.args['base-ref'] || gitConfig.baseRef || 'origin/main';
  const fallbackRef = gitConfig.fallbackRef || 'HEAD~1';

  let base = await mergeBase(ctx, baseRef);
  let baseLabel = base ? baseRef : null;
  if (!base) {
    base = await mergeBase(ctx, fallbackRef);
    baseLabel = base ? fallbackRef : null;
  }

  const collected = new Set();

  if (base) {
    const res = await git(ctx, ['diff', '--name-only', '--diff-filter=ACMR', base, 'HEAD']);
    if (res.code === 0) splitLines(res.stdout).forEach((file) => collected.add(file));
  }

  if (gitConfig.includeWorkingTree !== false) {
    const tracked = await git(ctx, ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']);
    if (tracked.code === 0) splitLines(tracked.stdout).forEach((file) => collected.add(file));
    const untracked = await git(ctx, ['ls-files', '--others', '--exclude-standard']);
    if (untracked.code === 0) splitLines(untracked.stdout).forEach((file) => collected.add(file));
  }

  const files = [...collected]
    .map((file) => file.split(path.win32.sep).join('/'))
    .filter((file) => fs.existsSync(path.join(ctx.projectRoot, file)))
    .sort();

  return { ok: true, base: baseLabel, baseSha: base, files };
}
