/**
 * Gate evaluation shared by the coverage and severity checks.
 *
 * `gates` in .vibeforce/config.json:
 *   apexOrgCoverageMin      org-wide Apex coverage floor (percent)
 *   apexClassCoverageMin    per class/trigger Apex coverage floor (percent)
 *   jestCoverageMin         LWC Jest line coverage floor (percent)
 *   analyzerFailSeverity    Code Analyzer severity that fails the build (1 Critical .. 5 Info)
 *   requireTestForApexClass every non-test Apex class needs a test class
 *   requireJestForLwc       every LWC module needs a __tests__ spec
 */

import { STATUS, gate, severityNumber } from './result.mjs';

export function gateConfig(config) {
  return {
    apexOrgCoverageMin: 85,
    apexClassCoverageMin: 75,
    jestCoverageMin: 80,
    analyzerFailSeverity: 3,
    requireTestForApexClass: true,
    requireJestForLwc: true,
    ...(config?.gates ?? {}),
  };
}

/** Percentage strings from the CLI arrive as `"87%"` or `"87.5"`. */
export function toPercent(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number.parseFloat(String(value).replace('%', '').trim());
  return Number.isFinite(numeric) ? numeric : null;
}

export function coverageGate(name, actual, minimum) {
  return gate({
    name,
    actual: actual === null ? 'n/a' : Math.round(actual * 10) / 10,
    required: minimum,
    comparator: '>=',
    unit: '%',
    status: actual === null ? STATUS.FAIL : actual >= minimum ? STATUS.PASS : STATUS.FAIL,
  });
}

/** Findings at or above the configured severity (numerically <=) fail the check. */
export function severityGate(findings, failSeverity) {
  const threshold = severityNumber(failSeverity);
  const blocking = findings.filter((item) => item.severity <= threshold);
  return {
    threshold,
    blocking,
    gate: gate({
      name: `findings<=sev${threshold}`,
      actual: blocking.length,
      required: 0,
      comparator: '<=',
      status: blocking.length === 0 ? STATUS.PASS : STATUS.FAIL,
    }),
  };
}

export function booleanGate(name, ok) {
  return gate({
    name,
    actual: ok ? 'yes' : 'no',
    required: 'yes',
    comparator: '==',
    status: ok ? STATUS.PASS : STATUS.FAIL,
  });
}

export function countGate(name, actual, maximum) {
  return gate({
    name,
    actual,
    required: maximum,
    comparator: '<=',
    status: actual <= maximum ? STATUS.PASS : STATUS.FAIL,
  });
}

export function anyGateFailed(gates) {
  return (gates ?? []).some((item) => item.status === STATUS.FAIL);
}
