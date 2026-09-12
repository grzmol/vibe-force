/**
 * Result and error vocabulary shared by every check module.
 *
 * Exit codes are part of the vibe-force check contract:
 *   0 pass, 1 gate failed, 2 misconfiguration/missing tool, 3 org or network error.
 */

export const EXIT = Object.freeze({
  PASS: 0,
  GATE: 1,
  CONFIG: 2,
  ORG: 3,
});

export const STATUS = Object.freeze({
  PASS: 'passed',
  FAIL: 'failed',
  SKIP: 'skipped',
});

const SEVERITY_LABELS = Object.freeze({
  1: 'critical',
  2: 'high',
  3: 'moderate',
  4: 'low',
  5: 'info',
});

/** Code Analyzer severity scale: 1 Critical .. 5 Info. Anything else is reported as `unknown`. */
export function severityLabel(severity) {
  return SEVERITY_LABELS[Number(severity)] ?? 'unknown';
}

/** Named severities accepted in config files, mapped to the numeric scale. */
export function severityNumber(value) {
  if (typeof value === 'number') return value;
  const name = String(value ?? '').toLowerCase();
  for (const [num, label] of Object.entries(SEVERITY_LABELS)) {
    if (label === name) return Number(num);
  }
  const parsed = Number.parseInt(name, 10);
  return Number.isFinite(parsed) ? parsed : 3;
}

/**
 * A single actionable problem. `file` is always project-relative POSIX, `line` may be null for
 * whole-file findings such as a missing test class.
 */
export function finding({ severity = 3, file = null, line = null, rule = '', message = '', engine = null, extra = null }) {
  return {
    severity: severityNumber(severity),
    severityLabel: severityLabel(severityNumber(severity)),
    file,
    line: line === null || line === undefined ? null : Number(line),
    rule,
    message,
    engine,
    ...(extra ? { extra } : {}),
  };
}

/** A pass/fail threshold comparison rendered in the `gates:` summary line. */
export function gate({ name, actual, required, comparator = '>=', status = null, unit = '' }) {
  const ok =
    status !== null
      ? status === STATUS.PASS
      : comparator === '>='
        ? Number(actual) >= Number(required)
        : comparator === '<='
          ? Number(actual) <= Number(required)
          : Boolean(actual);
  return {
    name,
    actual,
    required,
    comparator,
    unit,
    status: ok ? STATUS.PASS : STATUS.FAIL,
  };
}

export function makeResult(check, patch = {}) {
  return {
    check,
    status: STATUS.PASS,
    exitCode: EXIT.PASS,
    durationMs: 0,
    detail: '',
    findings: [],
    gates: [],
    steps: [],
    raw: {},
    ...patch,
  };
}

/** Marks a result as failed at the given exit code, keeping the worst code already present. */
export function fail(result, detail, exitCode = EXIT.GATE) {
  result.status = STATUS.FAIL;
  result.exitCode = Math.max(result.exitCode, exitCode);
  if (detail) result.detail = detail;
  return result;
}

export function skip(result, detail, hint = null) {
  result.status = STATUS.SKIP;
  result.detail = detail;
  if (hint) result.hint = hint;
  return result;
}

/**
 * Thrown for anything the operator must fix before the check can run: missing config, missing
 * tool, production guard, unresolvable org. Carries the exit code to surface.
 */
export class VfError extends Error {
  constructor(message, exitCode = EXIT.CONFIG, hint = null) {
    super(message);
    this.name = 'VfError';
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

/** Worst-of aggregation for composite checks. */
export function worseStatus(a, b) {
  if (a === STATUS.FAIL || b === STATUS.FAIL) return STATUS.FAIL;
  if (a === STATUS.SKIP || b === STATUS.SKIP) return STATUS.SKIP;
  return STATUS.PASS;
}

export function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      a.severity - b.severity ||
      String(a.file ?? '').localeCompare(String(b.file ?? '')) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      String(a.rule).localeCompare(String(b.rule)),
  );
}
