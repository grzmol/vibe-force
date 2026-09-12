/**
 * `deploy-validate`, `deploy-quick` and the deploy status probe used by `smoke`.
 *
 *   sf project deploy validate --target-org <alias> --test-level <level> [--tests ...]
 *     [--source-dir <dir>... | --manifest <xml>] --wait <minutes> --json
 *   sf project deploy quick --job-id <id> --target-org <alias> --wait <minutes> --json
 *   sf project deploy report --job-id <id> --target-org <alias> --json
 *
 * A validated job id is quick-deployable for 10 days from the start of the validation
 * (`project deploy quick --job-id` reference), so `deploy-quick` refuses stored entries older than
 * `config.deploy.quickJobMaxAgeDays`.
 *
 * Salesforce documents `project deploy validate` as a production command and recommends
 * `project deploy start --dry-run --test-level RunLocalTests` for sandboxes. With
 * `deploy.validateStrategy: "auto"` (the default) the runner follows that guidance: production
 * aliases get a real validation with a reusable job id, everything else gets a dry run. Only a
 * real validation is recorded for quick deploy, because a dry run does not produce a usable job.
 *
 * Docs: https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_deploy_validate.html
 *       https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_deploy_quick.html
 *       https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_deploy_report.html
 */

import fs from 'node:fs';
import path from 'node:path';
import { packageDirectories, requireSfdxProject } from './config.mjs';
import { resolveTargets, sourceDirsFor } from './files.mjs';
import { countGate } from './gates.mjs';
import { guardProduction, isProduction, resolveTargetOrg } from './org.mjs';
import { EXIT, VfError, fail, finding, makeResult, skip } from './result.mjs';
import { execJson, installHint, isToolMissing, resolveBin } from './run.mjs';
import { findValidatedJob, recordDeployJob } from './state.mjs';

function testLevelFor(ctx, production) {
  if (ctx.args['test-level']) return String(ctx.args['test-level']);
  const levels = ctx.config.testLevels ?? {};
  return production ? (levels.production ?? 'RunLocalTests') : (levels.sandbox ?? 'RunLocalTests');
}

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function scopeArgs(ctx) {
  if (ctx.args.manifest) {
    const manifest = path.resolve(ctx.projectRoot, String(ctx.args.manifest));
    if (!fs.existsSync(manifest)) {
      throw new VfError(`Manifest not found: ${manifest}`, EXIT.CONFIG);
    }
    return { args: ['--manifest', manifest], scope: `manifest ${path.relative(ctx.projectRoot, manifest)}` };
  }

  const pkgDirs = packageDirectories(ctx).filter((dir) => fs.existsSync(path.join(ctx.projectRoot, dir)));
  if (pkgDirs.length === 0) {
    throw new VfError(
      `No package directory exists under ${ctx.projectRoot}`,
      EXIT.CONFIG,
      'Create force-app/ or fix packageDirectories in sfdx-project.json.',
    );
  }

  const targets = await resolveTargets(ctx);
  if (targets.mode === 'all') {
    return { args: pkgDirs.flatMap((dir) => ['--source-dir', dir]), scope: `packages ${pkgDirs.join(', ')}` };
  }

  const dirs = sourceDirsFor(targets.files, pkgDirs);
  if (dirs.length === 0) {
    return { args: [], scope: 'nothing in scope', empty: true };
  }
  return {
    args: dirs.flatMap((dir) => ['--source-dir', dir]),
    scope: `${dirs.length} directories (${targets.mode})`,
  };
}

function collectComponentFailures(result, payload, ctx) {
  const failures = payload?.details?.componentFailures ?? payload?.files ?? [];
  const list = Array.isArray(failures) ? failures : [failures];
  for (const entry of list) {
    const problem = entry.problem ?? entry.error ?? null;
    if (!problem) continue;
    const file = entry.fileName ?? entry.filePath ?? null;
    result.findings.push(
      finding({
        severity: 1,
        file: file ? path.relative(ctx.projectRoot, path.resolve(ctx.projectRoot, file)).split(path.sep).join('/') : null,
        line: entry.lineNumber ?? null,
        rule: `deploy/${entry.problemType ?? 'error'}`,
        engine: 'metadata-api',
        message: `${entry.componentType ?? entry.type ?? 'component'} ${entry.fullName ?? ''}: ${problem}`.trim(),
      }),
    );
  }

  const runTestResult = payload?.details?.runTestResult;
  for (const failure of runTestResult?.failures ?? []) {
    result.findings.push(
      finding({
        severity: 1,
        rule: 'deploy/apex-test-failure',
        engine: 'apex',
        message: `${failure.name}.${failure.methodName}: ${(failure.message ?? '').split('\n')[0]}`,
      }),
    );
  }
  for (const item of runTestResult?.codeCoverageWarnings ?? []) {
    result.findings.push(
      finding({
        severity: 2,
        rule: 'deploy/coverage-warning',
        engine: 'apex',
        message: `${item.name ?? 'org'}: ${item.message}`,
      }),
    );
  }
}

export async function validate(ctx) {
  const result = makeResult('deploy-validate');
  requireSfdxProject(ctx.projectRoot);

  const targetOrg = resolveTargetOrg(ctx);
  const production = isProduction(targetOrg, ctx.config);
  guardProduction(ctx, targetOrg, 'banner');

  const strategy = ctx.args['validate-strategy'] || ctx.config.deploy?.validateStrategy || 'auto';
  const useValidate = strategy === 'validate' || (strategy === 'auto' && production);
  const testLevel = testLevelFor(ctx, production);
  const tests = splitList(ctx.args.tests);

  if (testLevel === 'RunSpecifiedTests' && tests.length === 0) {
    throw new VfError(
      'test-level RunSpecifiedTests requires test names',
      EXIT.CONFIG,
      'Pass --tests <Class,Class.method,...>.',
    );
  }

  const scope = await scopeArgs(ctx);
  if (scope.empty) {
    return skip(result, 'no deployable metadata in scope', 'Run without --changed to validate the whole package.');
  }

  const wait = Number(ctx.args.wait ?? ctx.config.deploy?.wait ?? 60);
  const args = useValidate
    ? ['project', 'deploy', 'validate']
    : ['project', 'deploy', 'start', '--dry-run', '--ignore-conflicts'];

  args.push(
    '--target-org',
    targetOrg,
    '--test-level',
    testLevel,
    ...tests.flatMap((value) => ['--tests', value]),
    ...scope.args,
    '--wait',
    String(wait),
    ...(ctx.config.deploy?.ignoreWarnings ? ['--ignore-warnings'] : []),
    '--json',
  );

  const res = await execJson(resolveBin(ctx.config, 'sf'), args, {
    cwd: ctx.projectRoot,
    env: ctx.env,
    timeoutMs: (ctx.config.deploy?.timeoutSeconds ?? 5400) * 1000,
  });

  result.raw = {
    command: ['sf', ...args].join(' '),
    strategy: useValidate ? 'validate' : 'dry-run',
    targetOrg,
    production,
    testLevel,
    scope: scope.scope,
    exitCode: res.code,
  };

  if (isToolMissing(res)) {
    return skip(result, 'Salesforce CLI (sf) is not available', installHint('sf'));
  }
  if (res.timedOut) {
    return fail(result, `deploy validation timed out after ${ctx.config.deploy?.timeoutSeconds ?? 5400}s`, EXIT.ORG);
  }

  const payload = res.json?.result ?? null;
  if (!payload) {
    const message = res.json?.message || res.stderr.trim().split('\n').slice(-3).join(' ') || `exit ${res.code}`;
    return fail(result, `deploy validation failed: ${message}`, EXIT.ORG);
  }

  collectComponentFailures(result, payload, ctx);

  const succeeded = payload.status === 'Succeeded' || payload.success === true;
  const componentCount = Number(payload.numberComponentsTotal ?? 0);
  result.raw.summary = {
    jobId: payload.id ?? null,
    status: payload.status ?? null,
    checkOnly: payload.checkOnly ?? useValidate,
    numberComponentsTotal: componentCount,
    numberComponentErrors: payload.numberComponentErrors ?? 0,
    numberTestErrors: payload.numberTestErrors ?? 0,
    numberTestsCompleted: payload.numberTestsCompleted ?? 0,
  };
  result.gates = [
    countGate('componentErrors', Number(payload.numberComponentErrors ?? 0), 0),
    countGate('testErrors', Number(payload.numberTestErrors ?? 0), 0),
  ];

  if (succeeded && useValidate && payload.id) {
    const job = recordDeployJob(ctx.projectRoot, {
      jobId: payload.id,
      targetOrg,
      createdAt: new Date().toISOString(),
      testLevel,
      componentCount,
      status: 'Succeeded',
    });
    result.raw.recordedJob = job;
    result.detail = `validated ${componentCount} components, job ${payload.id} quick-deployable for ${ctx.config.deploy?.quickJobMaxAgeDays ?? 10} days`;
  } else if (succeeded) {
    result.detail = `dry run passed for ${componentCount} components (no quick-deploy job id; strategy ${result.raw.strategy})`;
  } else {
    result.detail = `status ${payload.status ?? 'unknown'}, ${payload.numberComponentErrors ?? 0} component errors, ${payload.numberTestErrors ?? 0} test errors`;
    return fail(result, result.detail);
  }

  return result;
}

export async function quick(ctx) {
  const result = makeResult('deploy-quick');
  requireSfdxProject(ctx.projectRoot);

  const targetOrg = resolveTargetOrg(ctx);
  guardProduction(ctx, targetOrg, 'banner');

  const maxAgeDays = Number(ctx.config.deploy?.quickJobMaxAgeDays ?? 10);
  let jobId = ctx.args['job-id'] ? String(ctx.args['job-id']) : null;
  let source = 'flag';

  if (!jobId) {
    const found = findValidatedJob(ctx.projectRoot, targetOrg, maxAgeDays);
    if (!found.job) {
      throw new VfError(
        `Cannot quick deploy: ${found.reason}`,
        EXIT.CONFIG,
        `Run "vf-check deploy-validate --target-org ${targetOrg}" first, or pass --job-id <id> explicitly. Validated job ids expire after ${maxAgeDays} days.`,
      );
    }
    jobId = found.job.jobId;
    source = 'state';
    result.raw.validatedJob = found.job;
  }

  const wait = Number(ctx.args.wait ?? ctx.config.deploy?.wait ?? 60);
  const args = [
    'project',
    'deploy',
    'quick',
    '--job-id',
    jobId,
    '--target-org',
    targetOrg,
    '--wait',
    String(wait),
    '--json',
  ];

  const res = await execJson(resolveBin(ctx.config, 'sf'), args, {
    cwd: ctx.projectRoot,
    env: ctx.env,
    timeoutMs: (ctx.config.deploy?.timeoutSeconds ?? 5400) * 1000,
  });

  result.raw = {
    ...result.raw,
    command: ['sf', ...args].join(' '),
    targetOrg,
    jobId,
    jobIdSource: source,
    exitCode: res.code,
  };

  if (isToolMissing(res)) {
    return skip(result, 'Salesforce CLI (sf) is not available', installHint('sf'));
  }
  if (res.timedOut) {
    return fail(result, `quick deploy timed out after ${ctx.config.deploy?.timeoutSeconds ?? 5400}s`, EXIT.ORG);
  }

  const payload = res.json?.result ?? null;
  if (!payload) {
    const message = res.json?.message || res.stderr.trim().split('\n').slice(-3).join(' ') || `exit ${res.code}`;
    return fail(result, `quick deploy failed: ${message}`, EXIT.ORG);
  }

  collectComponentFailures(result, payload, ctx);
  const succeeded = payload.status === 'Succeeded' || payload.success === true;
  result.raw.summary = {
    jobId: payload.id ?? jobId,
    status: payload.status ?? null,
    numberComponentsDeployed: payload.numberComponentsDeployed ?? null,
    numberComponentErrors: payload.numberComponentErrors ?? 0,
  };
  result.gates = [countGate('componentErrors', Number(payload.numberComponentErrors ?? 0), 0)];
  result.detail = `job ${payload.id ?? jobId} status ${payload.status ?? 'unknown'}, ${payload.numberComponentsDeployed ?? 0} components deployed`;

  if (!succeeded) return fail(result, result.detail);

  // Keep the state file honest: a consumed job must not be offered again.
  recordDeployJob(ctx.projectRoot, {
    jobId: payload.id ?? jobId,
    targetOrg,
    createdAt: result.raw.validatedJob?.createdAt ?? new Date().toISOString(),
    testLevel: result.raw.validatedJob?.testLevel ?? 'unknown',
    componentCount: Number(payload.numberComponentsDeployed ?? result.raw.validatedJob?.componentCount ?? 0),
    status: 'Deployed',
  });
  return result;
}

/** Status probe reused by `smoke`; never fails the run on its own. */
export async function report(ctx, { jobId, targetOrg }) {
  const args = ['project', 'deploy', 'report', '--job-id', jobId, '--target-org', targetOrg, '--json'];
  const res = await execJson(resolveBin(ctx.config, 'sf'), args, {
    cwd: ctx.projectRoot,
    env: ctx.env,
    timeoutMs: 180000,
  });
  if (isToolMissing(res)) return { ok: false, toolMissing: true, reason: 'sf is not installed' };
  const payload = res.json?.result ?? null;
  if (!payload) {
    return { ok: false, reason: res.json?.message || res.stderr.trim().split('\n').slice(-2).join(' ') };
  }
  return {
    ok: true,
    status: payload.status ?? null,
    success: payload.status === 'Succeeded' || payload.success === true,
    numberComponentErrors: payload.numberComponentErrors ?? 0,
    numberTestErrors: payload.numberTestErrors ?? 0,
    completedDate: payload.completedDate ?? null,
    command: ['sf', ...args].join(' '),
  };
}
