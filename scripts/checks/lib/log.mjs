/**
 * Output surface for the check runner.
 *
 * Human mode (default): one status line per sub-check, then the findings list, then the gates
 * line. Machine mode (`--json`): stdout carries the report object and nothing else; progress,
 * warnings and errors go to stderr.
 */

import { STATUS, severityLabel, sortFindings } from './result.mjs';

const STATUS_TOKEN = {
  [STATUS.PASS]: 'pass',
  [STATUS.FAIL]: 'fail',
  [STATUS.SKIP]: 'skip',
};

function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function formatMs(ms) {
  const value = Number(ms) || 0;
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

export function createLogger({ json = false, quiet = false, stdout = process.stdout, stderr = process.stderr } = {}) {
  const human = (text) => {
    if (quiet) return;
    (json ? stderr : stdout).write(`${text}\n`);
  };

  return {
    json,
    quiet,

    /** `[pass] format (312ms) 12 files checked` */
    status(result) {
      const token = STATUS_TOKEN[result.status] ?? result.status;
      human(
        `[${token}] ${pad(result.check, 16)} (${formatMs(result.durationMs)})${result.detail ? ` ${result.detail}` : ''}`,
      );
      if (result.status === STATUS.SKIP && result.hint) human(`       hint: ${result.hint}`);
    },

    /** `high  force-app/.../Foo.cls:42  ApexCRUDViolation  message` */
    findings(findings, { limit = 50 } = {}) {
      if (!findings || findings.length === 0) return;
      const sorted = sortFindings(findings);
      human('');
      human(`findings (${sorted.length}):`);
      for (const item of sorted.slice(0, limit)) {
        const where = item.file ? `${item.file}${item.line ? `:${item.line}` : ''}` : '-';
        human(
          `  ${pad(item.severityLabel ?? severityLabel(item.severity), 8)} ${where}  ${item.rule || '-'}  ${item.message}`,
        );
      }
      if (sorted.length > limit) human(`  ... ${sorted.length - limit} more (see the JSON report)`);
    },

    gates(gates) {
      if (!gates || gates.length === 0) return;
      const rendered = gates
        .map((g) => {
          const value = typeof g.actual === 'number' ? `${g.actual}${g.unit ?? ''}` : String(g.actual);
          const need = typeof g.required === 'number' ? `${g.required}${g.unit ?? ''}` : String(g.required);
          return `${g.name}=${value}${g.required === undefined ? '' : ` (need ${g.comparator} ${need})`} ${STATUS_TOKEN[g.status]}`;
        })
        .join('; ');
      human(`gates: ${rendered}`);
    },

    banner(text) {
      const bar = '='.repeat(Math.min(78, Math.max(20, text.length + 8)));
      stderr.write(`${bar}\n  ${text}\n${bar}\n`);
    },

    note(text) {
      human(text);
    },

    warn(text) {
      stderr.write(`warning: ${text}\n`);
    },

    error(text, hint = null) {
      stderr.write(`error: ${text}\n`);
      if (hint) stderr.write(`hint: ${hint}\n`);
    },

    reportPath(file) {
      if (file) human(`report: ${file}`);
    },

    emitReport(report) {
      if (!json) return;
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    },
  };
}
