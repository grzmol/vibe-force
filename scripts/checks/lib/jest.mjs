/**
 * `jest` - LWC unit tests through @salesforce/sfdx-lwc-jest.
 *
 *   sfdx-lwc-jest -- --coverage --json --outputFile <f> --coverageReporters=json-summary
 *     --coverageDirectory=<dir>
 *
 * Everything after `--` is forwarded to Jest, which is how coverage is redirected to a temporary
 * directory instead of polluting the project. The line percentage comes from
 * `<coverageDirectory>/coverage-summary.json` (`total.lines.pct`).
 *
 * Docs: https://github.com/salesforce/sfdx-lwc-jest#usage
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packageDirectories } from './config.mjs';
import { classify, resolveTargets, walk } from './files.mjs';
import { coverageGate, countGate, gateConfig } from './gates.mjs';
import { fail, finding, makeResult, skip } from './result.mjs';
import { exec, extractJson, installHint, isToolMissing, resolveNodeTool } from './run.mjs';

function hasAnySpec(ctx) {
  const pkgDirs = packageDirectories(ctx);
  for (const dir of pkgDirs) {
    const abs = path.join(ctx.projectRoot, dir);
    if (!fs.existsSync(abs)) continue;
    const found = walk(abs, { relativeTo: ctx.projectRoot }).some((file) =>
      /__tests__\/.*\.(test|spec)\.[jt]s$/.test(file),
    );
    if (found) return true;
  }
  return false;
}

function readCoverage(dir) {
  const summary = path.join(dir, 'coverage-summary.json');
  if (!fs.existsSync(summary)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(summary, 'utf8'));
    return parsed.total ?? null;
  } catch {
    return null;
  }
}

export async function run(ctx) {
  const result = makeResult('jest');
  const gates = gateConfig(ctx.config);

  if (!fs.existsSync(path.join(ctx.projectRoot, 'package.json'))) {
    return skip(
      result,
      'no package.json',
      `Scaffold one from ${path.join(ctx.pluginRoot, 'templates', 'package.json')} and run npm install.`,
    );
  }
  if (!hasAnySpec(ctx)) {
    return skip(result, 'no LWC Jest specs found', 'Add force-app/**/lwc/<module>/__tests__/<module>.test.js.');
  }

  const targets = await resolveTargets(ctx);
  if (targets.warning) ctx.log.warn(targets.warning);

  // Scope to the changed modules when possible; Jest matches on path substrings.
  const scoped = targets.mode === 'all' ? [] : [...new Set(classify(targets.files).lwcModules)];
  if (targets.mode !== 'all' && scoped.length === 0) {
    return skip(result, `no LWC modules in scope (${targets.mode})`);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-jest-'));
  const resultFile = path.join(workDir, 'jest-results.json');
  const coverageDir = path.join(workDir, 'coverage');

  const tool = resolveNodeTool({
    config: ctx.config,
    projectRoot: ctx.projectRoot,
    key: 'jest',
    tool: 'sfdx-lwc-jest',
  });

  const jestArgs = [
    '--coverage',
    '--json',
    `--outputFile=${resultFile}`,
    `--coverageDirectory=${coverageDir}`,
    ...(ctx.config.jest?.coverageReporters ?? ['json-summary']).map(
      (reporter) => `--coverageReporters=${reporter}`,
    ),
    ...(ctx.config.jest?.passWithNoTests === false ? [] : ['--passWithNoTests']),
    ...(ctx.args.fix ? ['--updateSnapshot'] : []),
    ...scoped,
  ];
  const args = [...tool.prefix, '--', ...jestArgs];

  const res = await exec(tool.bin, args, {
    cwd: ctx.projectRoot,
    env: ctx.env,
    timeoutMs: (ctx.config.jest?.timeoutSeconds ?? 900) * 1000,
  });

  result.raw = {
    command: [tool.bin, ...args].join(' '),
    mode: targets.mode,
    scopedModules: scoped,
    exitCode: res.code,
  };

  if (isToolMissing(res)) {
    fs.rmSync(workDir, { recursive: true, force: true });
    return skip(result, 'sfdx-lwc-jest is not available', installHint('sfdx-lwc-jest'));
  }
  if (res.timedOut) {
    fs.rmSync(workDir, { recursive: true, force: true });
    return fail(result, `jest timed out after ${ctx.config.jest?.timeoutSeconds ?? 900}s`);
  }

  let payload = null;
  if (fs.existsSync(resultFile)) {
    try {
      payload = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    } catch (err) {
      result.raw.parseError = err.message;
    }
  }
  payload ??= extractJson(res.stdout);

  const coverage = readCoverage(coverageDir);
  fs.rmSync(workDir, { recursive: true, force: true });

  if (!payload) {
    return fail(
      result,
      `jest produced no JSON result (exit ${res.code}): ${res.stderr.trim().split('\n').slice(-3).join(' ')}`,
    );
  }

  for (const suite of payload.testResults ?? []) {
    const relative = suite.name
      ? path.relative(ctx.projectRoot, suite.name).split(path.sep).join('/')
      : null;
    if (suite.status === 'failed' && suite.message && (suite.assertionResults ?? []).length === 0) {
      result.findings.push(
        finding({
          severity: 1,
          file: relative,
          rule: 'jest/suite-failure',
          engine: 'jest',
          message: suite.message.trim().split('\n')[0],
        }),
      );
    }
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status !== 'failed') continue;
      result.findings.push(
        finding({
          severity: 1,
          file: relative,
          line: assertion.location?.line ?? null,
          rule: 'jest/test-failure',
          engine: 'jest',
          message: `${assertion.fullName}: ${(assertion.failureMessages ?? [''])[0].split('\n')[0]}`,
        }),
      );
    }
  }

  const failed = payload.numFailedTests ?? 0;
  const failedSuites = payload.numFailedTestSuites ?? 0;
  const passed = payload.numPassedTests ?? 0;
  const linePct = coverage?.lines?.pct ?? null;

  result.gates = [
    countGate('jestFailures', failed, 0),
    countGate('jestSuiteFailures', failedSuites, 0),
    coverageGate('jestLineCoverage', linePct, gates.jestCoverageMin),
  ];
  result.raw.summary = {
    numPassedTests: passed,
    numFailedTests: failed,
    numFailedTestSuites: failedSuites,
    numTotalTests: payload.numTotalTests ?? passed + failed,
    coverage: coverage
      ? {
          lines: coverage.lines?.pct ?? null,
          statements: coverage.statements?.pct ?? null,
          functions: coverage.functions?.pct ?? null,
          branches: coverage.branches?.pct ?? null,
        }
      : null,
  };
  result.detail = `${passed} passed, ${failed} failed, coverage ${linePct === null ? 'n/a' : `${linePct}%`} (min ${gates.jestCoverageMin}%)`;

  if (failed + failedSuites > 0 || linePct === null || linePct < gates.jestCoverageMin) {
    return fail(result, result.detail);
  }
  return result;
}
