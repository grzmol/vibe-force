/**
 * Report persistence: `<project>/.vibeforce/reports/<check>-<timestamp>.json`.
 *
 * Timestamps are ISO-8601 with `:` and `.` replaced by `-` so the filenames are valid on Windows
 * and sort lexicographically. Writes are atomic (temp file + rename) and the directory is pruned
 * to `config.reports.keep` files (default 50).
 */

import fs from 'node:fs';
import path from 'node:path';
import { EXIT, VfError } from './result.mjs';

export const REPORT_DIR_RELATIVE = path.join('.vibeforce', 'reports');

export function reportFileName(check, startedAt) {
  const stamp = startedAt.replace(/:/g, '-').replace(/\./g, '-');
  return `${check}-${stamp}.json`;
}

export function buildReport({ check, startedAt, durationMs, result, context }) {
  return {
    check,
    startedAt,
    durationMs,
    status: result.status,
    exitCode: result.exitCode,
    detail: result.detail,
    gates: result.gates ?? [],
    findings: result.findings ?? [],
    steps: (result.steps ?? []).map((step) => ({
      check: step.check,
      status: step.status,
      durationMs: step.durationMs,
      detail: step.detail,
      exitCode: step.exitCode,
      ...(step.hint ? { hint: step.hint } : {}),
    })),
    context,
    raw: result.raw ?? {},
  };
}

/** Removes secrets (org access tokens, auth URLs) before anything is written to disk. */
export function redact(value, keys) {
  const blocked = new Set((keys ?? []).map((key) => key.toLowerCase()));
  const seen = new WeakSet();

  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      if (seen.has(node)) return '[circular]';
      seen.add(node);
      const out = {};
      for (const [key, child] of Object.entries(node)) {
        out[key] = blocked.has(key.toLowerCase()) ? '[redacted]' : walk(child);
      }
      return out;
    }
    return node;
  };

  return walk(value);
}

export function writeReport({ projectRoot, config, report, explicitPath = null }) {
  const safe = redact(report, config?.reports?.redactKeys ?? []);
  const target = explicitPath
    ? path.resolve(projectRoot, explicitPath)
    : path.join(projectRoot, REPORT_DIR_RELATIVE, reportFileName(report.check, report.startedAt));

  const dir = path.dirname(target);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new VfError(`Cannot create report directory ${dir}: ${err.message}`, EXIT.CONFIG);
  }

  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(safe, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // The temp file may never have been created; nothing to clean up.
    }
    throw new VfError(`Cannot write report ${target}: ${err.message}`, EXIT.CONFIG);
  }

  if (!explicitPath) prune(dir, config?.reports?.keep ?? 50);
  return target;
}

function prune(dir, keep) {
  if (!Number.isFinite(keep) || keep <= 0) return;
  let entries;
  try {
    entries = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return;
  }
  if (entries.length <= keep) return;
  for (const name of entries.sort().slice(0, entries.length - keep)) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      // A concurrent run may have removed it already.
    }
  }
}
