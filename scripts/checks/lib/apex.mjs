/**
 * `apex` - Apex tests in a real org.
 *
 *   sf apex run test --target-org <alias> --code-coverage --result-format json --json
 *     --wait <minutes> [--tests ... | --class-names ... | --suite-names ... | --test-level ...]
 *
 * `--json` wraps the payload as `{status, result}`; `result` is the apex-node TestResult:
 * `{summary:{outcome,testsRan,passing,failing,skipped,orgWideCoverage,testRunCoverage,testRunId},
 *   tests:[{fullName,outcome,message,stackTrace}], codecoverage:[{name,type,percentage,
 *   numLinesCovered,numLinesUncovered}]}`.
 * Sources: https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_apex_run_test.html
 *          https://github.com/forcedotcom/salesforcedx-apex/blob/main/src/tests/types.ts
 *
 * `--class-names`, `--suite-names` and `--tests` are mutually exclusive, and `--test-level`
 * RunSpecifiedTests requires `--tests`.
 */

import path from 'node:path';
import { classify, resolveTargets } from './files.mjs';
import { coverageGate, countGate, gateConfig, toPercent } from './gates.mjs';
import { guardProduction, resolveTargetOrg } from './org.mjs';
import { EXIT, fail, finding, makeResult, skip } from './result.mjs';
import { execJson, installHint, isToolMissing, resolveBin } from './run.mjs';

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Test-class names implied by the changed Apex sources, used for RunSpecifiedTests scoping. */
function impliedTests(ctx, targets) {
  const scope = classify(targets.files);
  const names = new Set(scope.apexTests.map((file) => path.basename(file, path.extname(file))));
  for (const file of [...scope.apexClasses, ...scope.apexTriggers]) {
    const base = path.basename(file, path.extname(file));
    for (const candidate of [`${base}Test`, `${base}Tests`, `Test${base}`]) {
      if (targets.files.some((f) => f.endsWith(`/${candidate}.cls`))) names.add(candidate);
    }
  }
  return [...names];
}

export async function run(ctx) {
  const result = makeResult('apex');
  const gates = gateConfig(ctx.config);
  const targetOrg = resolveTargetOrg(ctx);
  const production = guardProduction(ctx, targetOrg, 'refuse');

  const explicitTests = splitList(ctx.args.tests);
  const classNames = splitList(ctx.args['class-names']);
  const suiteNames = splitList(ctx.args['suite-names']);

  const targets = await resolveTargets(ctx);
  if (targets.warning) ctx.log.warn(targets.warning);

  let selection;
  if (explicitTests.length > 0) {
    selection = { flag: '--tests', values: explicitTests, testLevel: 'RunSpecifiedTests' };
  } else if (classNames.length > 0) {
    selection = { flag: '--class-names', values: classNames, testLevel: null };
  } else if (suiteNames.length > 0) {
    selection = { flag: '--suite-names', values: suiteNames, testLevel: null };
  } else if (ctx.args['test-level']) {
    selection = { flag: null, values: [], testLevel: String(ctx.args['test-level']) };
  } else if (targets.mode === 'changed') {
    const derived = impliedTests(ctx, targets);
    selection =
      derived.length > 0
        ? { flag: '--tests', values: derived, testLevel: 'RunSpecifiedTests' }
        : { flag: null, values: [], testLevel: 'RunLocalTests' };
  } else {
    selection = { flag: null, values: [], testLevel: 'RunLocalTests' };
  }

  if (selection.testLevel === 'RunSpecifiedTests' && selection.values.length === 0) {
    return skip(
      result,
      'RunSpecifiedTests without test names',
      'Pass --tests <Class,Class.method,...> or drop --test-level.',
    );
  }

  const wait = Number(ctx.args.wait ?? ctx.config.apex?.wait ?? 30);
  const synchronous =
    ctx.config.apex?.synchronousSingleClass === true &&
    selection.flag === '--class-names' &&
    selection.values.length === 1;

  const args = [
    'apex',
    'run',
    'test',
    '--target-org',
    targetOrg,
    '--code-coverage',
    '--result-format',
    'json',
    '--json',
    '--wait',
    String(wait),
    ...(ctx.config.apex?.pollIntervalSeconds
      ? ['--poll-interval', String(ctx.config.apex.pollIntervalSeconds)]
      : []),
    ...(selection.flag ? selection.values.flatMap((value) => [selection.flag, value]) : []),
    ...(selection.testLevel ? ['--test-level', selection.testLevel] : []),
    ...(synchronous ? ['--synchronous'] : []),
  ];

  const res = await execJson(resolveBin(ctx.config, 'sf'), args, {
    cwd: ctx.projectRoot,
    env: ctx.env,
    timeoutMs: (ctx.config.apex?.timeoutSeconds ?? 2400) * 1000,
  });

  result.raw = {
    command: ['sf', ...args].join(' '),
    targetOrg,
    production: production.production,
    testLevel: selection.testLevel,
    selection: { flag: selection.flag, values: selection.values },
    exitCode: res.code,
  };

  if (isToolMissing(res)) {
    return skip(result, 'Salesforce CLI (sf) is not available', installHint('sf'));
  }
  if (res.timedOut) {
    return fail(result, `sf apex run test timed out after ${ctx.config.apex?.timeoutSeconds ?? 2400}s`, EXIT.ORG);
  }

  const payload = res.json?.result ?? res.json ?? null;
  if (!payload?.summary) {
    const message = res.json?.message || res.stderr.trim().split('\n').slice(-3).join(' ') || `exit ${res.code}`;
    return fail(result, `sf apex run test failed: ${message}`, EXIT.ORG);
  }

  const summary = payload.summary;
  for (const test of payload.tests ?? []) {
    if (test.outcome === 'Pass' || test.outcome === 'Skip') continue;
    result.findings.push(
      finding({
        severity: 1,
        file: null,
        rule: `apex/${test.outcome === 'CompileFail' ? 'compile-failure' : 'test-failure'}`,
        engine: 'apex',
        message: `${test.fullName ?? test.methodName}: ${(test.message ?? '').split('\n')[0]}`,
        extra: test.stackTrace ? { stackTrace: String(test.stackTrace).split('\n').slice(0, 3) } : null,
      }),
    );
  }

  const orgCoverage = toPercent(summary.orgWideCoverage);
  const runCoverage = toPercent(summary.testRunCoverage);

  // Per-class coverage: scope to the classes in play when --changed narrowed the run.
  const changedNames = new Set(
    classify(targets.files)
      .apexClasses.concat(classify(targets.files).apexTriggers)
      .map((file) => path.basename(file, path.extname(file))),
  );
  const scopeCoverage = ctx.config.apex?.coverageScope === 'all' || changedNames.size === 0;
  let lowestClass = null;
  let belowMin = 0;

  for (const entry of payload.codecoverage ?? []) {
    if (!scopeCoverage && !changedNames.has(entry.name)) continue;
    const pct = toPercent(entry.percentage);
    if (pct === null) continue;
    if (lowestClass === null || pct < lowestClass.pct) lowestClass = { name: entry.name, pct };
    if (pct < gates.apexClassCoverageMin) {
      belowMin += 1;
      result.findings.push(
        finding({
          severity: 2,
          file: null,
          rule: 'apex/classCoverage',
          engine: 'apex',
          message: `${entry.type ?? 'ApexClass'} ${entry.name} at ${pct}% (min ${gates.apexClassCoverageMin}%), ${entry.numLinesUncovered} lines uncovered`,
        }),
      );
    }
  }

  result.gates = [
    countGate('apexFailures', Number(summary.failing ?? 0), 0),
    coverageGate('apexOrgCoverage', orgCoverage, gates.apexOrgCoverageMin),
    coverageGate('apexClassCoverage', lowestClass ? lowestClass.pct : null, gates.apexClassCoverageMin),
  ];
  result.raw.summary = {
    outcome: summary.outcome,
    testsRan: summary.testsRan,
    passing: summary.passing,
    failing: summary.failing,
    skipped: summary.skipped,
    testRunId: summary.testRunId,
    orgWideCoverage: summary.orgWideCoverage ?? null,
    testRunCoverage: summary.testRunCoverage ?? null,
  };
  result.raw.coverageScope = scopeCoverage ? 'all' : 'changed';
  result.detail = `${summary.passing ?? 0}/${summary.testsRan ?? 0} passed, org coverage ${orgCoverage ?? 'n/a'}% (min ${gates.apexOrgCoverageMin}%), run coverage ${runCoverage ?? 'n/a'}%, ${belowMin} classes below ${gates.apexClassCoverageMin}%`;

  const failedGate =
    Number(summary.failing ?? 0) > 0 ||
    orgCoverage === null ||
    orgCoverage < gates.apexOrgCoverageMin ||
    belowMin > 0;
  if (failedGate) return fail(result, result.detail);
  return result;
}
