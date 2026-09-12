/**
 * `smoke` - post-deploy verification against a real org.
 *
 * Runs, in order:
 *   1. `sf project deploy report --job-id <id>` when a job id is known for the org
 *   2. `sf apex run --file <smoke.apex>` (project copy, else the packaged template)
 *   3. `sf data query --query <soql>` for every entry in `config.smoke.queries[]`
 *   4. `sf org list limits` (the `limits api display` alias is deprecated)
 *   5. `sf apex list log` scanned for failed requests
 *
 * All five probes are read-only, so production runs are allowed with a banner rather than
 * refused. Findings are aggregated with per-probe severities and the check fails when any
 * critical or high finding is present.
 *
 * Docs: https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_apex_run.html
 *       https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_data_query.html
 *       https://github.com/salesforcecli/plugin-limits (org list limits returns [{name,max,remaining}])
 *       https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_apex_list_log.html
 */

import fs from 'node:fs';
import path from 'node:path';
import { report as deployReport } from './deploy.mjs';
import { countGate, severityGate, gateConfig } from './gates.mjs';
import { describeOrg, guardProduction, resolveTargetOrg } from './org.mjs';
import { STATUS, fail, finding, makeResult } from './result.mjs';
import { execJson, isToolMissing, resolveBin } from './run.mjs';
import { findValidatedJob, readDeployJobs } from './state.mjs';

function sf(ctx, args, timeoutMs = 180000) {
  return execJson(resolveBin(ctx.config, 'sf'), args, {
    cwd: ctx.projectRoot,
    env: ctx.env,
    timeoutMs,
  });
}

function apexFile(ctx) {
  const relative = ctx.args['apex-file'] || ctx.config.smoke?.apexFile || 'scripts/apex/smoke.apex';
  const projectCopy = path.resolve(ctx.projectRoot, relative);
  if (fs.existsSync(projectCopy)) return { file: projectCopy, source: 'project' };
  const template = path.join(ctx.pluginRoot, 'templates', 'scripts', 'apex', 'smoke.apex');
  if (fs.existsSync(template)) return { file: template, source: 'template' };
  return { file: null, source: null };
}

async function probeDeployReport(ctx, targetOrg, result) {
  const explicit = ctx.args['job-id'] ? String(ctx.args['job-id']) : null;
  const maxAge = Number(ctx.config.deploy?.quickJobMaxAgeDays ?? 10);
  const fromState = explicit
    ? null
    : (findValidatedJob(ctx.projectRoot, targetOrg, maxAge).job ??
      readDeployJobs(ctx.projectRoot).jobs.find((job) => job.targetOrg === targetOrg) ??
      null);
  const jobId = explicit ?? fromState?.jobId ?? null;

  if (!jobId) {
    return { probe: 'deploy-report', status: STATUS.SKIP, detail: 'no deploy job id known for this org' };
  }

  const res = await deployReport(ctx, { jobId, targetOrg });
  if (!res.ok) {
    return { probe: 'deploy-report', status: STATUS.SKIP, detail: res.reason ?? 'deploy report unavailable', jobId };
  }
  if (!res.success) {
    result.findings.push(
      finding({
        severity: 1,
        rule: 'smoke/deploy-status',
        engine: 'metadata-api',
        message: `Deploy job ${jobId} status ${res.status} (${res.numberComponentErrors} component errors, ${res.numberTestErrors} test errors)`,
      }),
    );
    return { probe: 'deploy-report', status: STATUS.FAIL, detail: `job ${jobId} status ${res.status}`, jobId };
  }
  return { probe: 'deploy-report', status: STATUS.PASS, detail: `job ${jobId} ${res.status}`, jobId };
}

async function probeAnonymousApex(ctx, targetOrg, result) {
  const { file, source } = apexFile(ctx);
  if (!file) {
    return { probe: 'anonymous-apex', status: STATUS.SKIP, detail: 'no smoke.apex found' };
  }

  const res = await sf(ctx, ['apex', 'run', '--file', file, '--target-org', targetOrg, '--json'], 300000);
  if (isToolMissing(res)) {
    return { probe: 'anonymous-apex', status: STATUS.SKIP, detail: 'sf is not installed' };
  }
  const payload = res.json?.result ?? null;
  if (!payload) {
    result.findings.push(
      finding({
        severity: 2,
        rule: 'smoke/anonymous-apex',
        engine: 'apex',
        message: `sf apex run produced no result: ${res.json?.message ?? res.stderr.trim().split('\n').slice(-1)[0]}`,
      }),
    );
    return { probe: 'anonymous-apex', status: STATUS.FAIL, detail: 'no result payload' };
  }

  const compiled = payload.compiled !== false;
  const success = payload.success === true;
  if (!compiled || !success) {
    result.findings.push(
      finding({
        severity: 1,
        file: path.relative(ctx.projectRoot, file).split(path.sep).join('/'),
        line: payload.line ?? null,
        rule: compiled ? 'smoke/apex-exception' : 'smoke/apex-compile',
        engine: 'apex',
        message:
          (compiled ? payload.exceptionMessage : payload.compileProblem) ||
          'anonymous Apex failed without a message',
        extra: payload.exceptionStackTrace ? { stackTrace: String(payload.exceptionStackTrace).split('\n').slice(0, 3) } : null,
      }),
    );
    return {
      probe: 'anonymous-apex',
      status: STATUS.FAIL,
      detail: compiled ? 'runtime exception' : 'compile error',
      source,
    };
  }

  // The template script prints assertion output; surface any VF_SMOKE_FAIL marker it emits.
  const logs = String(payload.logs ?? '');
  const markers = logs
    .split('\n')
    .filter((line) => line.includes('VF_SMOKE_FAIL'))
    .map((line) => line.trim());
  for (const marker of markers) {
    result.findings.push(
      finding({
        severity: 2,
        rule: 'smoke/apex-assertion',
        engine: 'apex',
        message: marker.slice(marker.indexOf('VF_SMOKE_FAIL')),
      }),
    );
  }

  return {
    probe: 'anonymous-apex',
    status: markers.length > 0 ? STATUS.FAIL : STATUS.PASS,
    detail: `${source} script, ${markers.length} assertion failures`,
    source,
  };
}

async function probeQueries(ctx, targetOrg, result) {
  const queries = ctx.config.smoke?.queries ?? [];
  if (queries.length === 0) {
    return { probe: 'soql', status: STATUS.SKIP, detail: 'no smoke.queries configured' };
  }

  let failures = 0;
  const details = [];

  for (const query of queries) {
    if (!query?.soql) continue;
    const args = [
      'data',
      'query',
      '--query',
      query.soql,
      '--target-org',
      targetOrg,
      '--json',
      ...(query.toolingApi ? ['--use-tooling-api'] : []),
    ];
    const res = await sf(ctx, args);
    if (isToolMissing(res)) {
      return { probe: 'soql', status: STATUS.SKIP, detail: 'sf is not installed' };
    }
    const payload = res.json?.result ?? null;
    if (!payload) {
      failures += 1;
      result.findings.push(
        finding({
          severity: 2,
          rule: `smoke/query:${query.name ?? 'unnamed'}`,
          engine: 'soql',
          message: `Query failed: ${res.json?.message ?? res.stderr.trim().split('\n').slice(-1)[0]}`,
        }),
      );
      continue;
    }

    const total = Number(payload.totalSize ?? (payload.records ?? []).length);
    const expect = query.expect ?? {};
    const problems = [];
    if (expect.minRecords !== undefined && total < Number(expect.minRecords)) {
      problems.push(`expected at least ${expect.minRecords} records, got ${total}`);
    }
    if (expect.maxRecords !== undefined && total > Number(expect.maxRecords)) {
      problems.push(`expected at most ${expect.maxRecords} records, got ${total}`);
    }

    if (problems.length > 0) {
      failures += 1;
      result.findings.push(
        finding({
          severity: query.severityOnFail ?? 2,
          rule: `smoke/query:${query.name ?? 'unnamed'}`,
          engine: 'soql',
          message: `${problems.join('; ')}. SOQL: ${query.soql}`,
          extra: (payload.records ?? []).length
            ? { sample: (payload.records ?? []).slice(0, 3) }
            : null,
        }),
      );
    }
    details.push(`${query.name ?? 'query'}=${total}`);
  }

  return {
    probe: 'soql',
    status: failures > 0 ? STATUS.FAIL : STATUS.PASS,
    detail: `${queries.length} queries, ${failures} failed${details.length ? ` (${details.join(', ')})` : ''}`,
  };
}

async function probeLimits(ctx, targetOrg, result) {
  if (ctx.config.smoke?.checkLimits === false) {
    return { probe: 'limits', status: STATUS.SKIP, detail: 'disabled in config' };
  }

  const res = await sf(ctx, ['org', 'list', 'limits', '--target-org', targetOrg, '--json']);
  if (isToolMissing(res)) {
    return { probe: 'limits', status: STATUS.SKIP, detail: 'sf is not installed' };
  }
  const payload = res.json?.result ?? null;
  const limits = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? Object.entries(payload).map(([name, value]) => ({
          name,
          max: value?.Max ?? value?.max,
          remaining: value?.Remaining ?? value?.remaining,
        }))
      : null;

  if (!limits) {
    return { probe: 'limits', status: STATUS.SKIP, detail: res.json?.message ?? 'no limits payload' };
  }

  const warnPercent = Number(ctx.config.smoke?.limitsWarnRemainingPercent ?? 15);
  const tracked = new Set([
    'DailyApiRequests',
    'DailyAsyncApexExecutions',
    'DailyBulkApiBatches',
    'DailyBulkV2QueryJobs',
    'DailyDurableGenericStreamingApiEvents',
    'DailyWorkflowEmails',
    'DataStorageMB',
    'FileStorageMB',
    'HourlyAsyncReportRuns',
    'SingleEmail',
    'MassEmail',
  ]);

  let warnings = 0;
  const low = [];
  for (const limit of limits) {
    const max = Number(limit.max);
    const remaining = Number(limit.remaining);
    if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(remaining)) continue;
    const pct = (remaining / max) * 100;
    if (pct >= warnPercent) continue;
    if (!tracked.has(limit.name) && pct >= 5) continue;
    warnings += 1;
    low.push(`${limit.name} ${pct.toFixed(1)}%`);
    result.findings.push(
      finding({
        severity: pct < 5 ? 2 : 3,
        rule: 'smoke/org-limit',
        engine: 'limits',
        message: `${limit.name}: ${remaining} of ${max} remaining (${pct.toFixed(1)}%, warn below ${warnPercent}%)`,
      }),
    );
  }

  return {
    probe: 'limits',
    status: STATUS.PASS,
    detail: `${limits.length} limits read, ${warnings} near exhaustion${low.length ? ` (${low.slice(0, 3).join(', ')})` : ''}`,
  };
}

async function probeLogs(ctx, targetOrg, result) {
  if (ctx.config.smoke?.logScan === false) {
    return { probe: 'apex-logs', status: STATUS.SKIP, detail: 'disabled in config' };
  }

  const res = await sf(ctx, ['apex', 'list', 'log', '--target-org', targetOrg, '--json']);
  if (isToolMissing(res)) {
    return { probe: 'apex-logs', status: STATUS.SKIP, detail: 'sf is not installed' };
  }
  const payload = res.json?.result ?? null;
  const logs = Array.isArray(payload) ? payload : (payload?.records ?? null);
  if (!logs) {
    return { probe: 'apex-logs', status: STATUS.SKIP, detail: res.json?.message ?? 'no debug logs available' };
  }

  const limit = Number(ctx.config.smoke?.logScanMax ?? 25);
  const recent = logs.slice(0, limit);
  let failures = 0;
  for (const log of recent) {
    const status = String(log.Status ?? log.status ?? '');
    if (status.length === 0 || /^success$/i.test(status)) continue;
    failures += 1;
    result.findings.push(
      finding({
        severity: 3,
        rule: 'smoke/apex-log',
        engine: 'apex',
        message: `${log.Operation ?? log.operation ?? 'operation'} at ${log.StartTime ?? log.startTime ?? 'unknown time'} finished with status "${status}" (log ${log.Id ?? log.id})`,
      }),
    );
  }

  return {
    probe: 'apex-logs',
    status: STATUS.PASS,
    detail: `${recent.length} recent logs scanned, ${failures} non-success`,
  };
}

export async function run(ctx) {
  const result = makeResult('smoke');
  const gates = gateConfig(ctx.config);
  const targetOrg = resolveTargetOrg(ctx);
  const production = guardProduction(ctx, targetOrg, 'banner');

  // Confirm the org is reachable first: every probe below would fail identically otherwise, and
  // the identity belongs in the report so a post-deploy verification can be attributed to an org.
  const org = await describeOrg(ctx, targetOrg);
  ctx.log.status({
    check: 'smoke:org',
    status: STATUS.PASS,
    durationMs: 0,
    detail: `${org.username} (${org.orgId}) api ${org.apiVersion}, ${org.connectedStatus}`,
  });

  const probes = [];
  probes.push(await probeDeployReport(ctx, targetOrg, result));
  probes.push(await probeAnonymousApex(ctx, targetOrg, result));
  probes.push(await probeQueries(ctx, targetOrg, result));
  probes.push(await probeLimits(ctx, targetOrg, result));
  probes.push(await probeLogs(ctx, targetOrg, result));

  for (const probe of probes) {
    ctx.log.status({
      check: `smoke:${probe.probe}`,
      status: probe.status,
      durationMs: 0,
      detail: probe.detail,
    });
  }

  const blocking = result.findings.filter((item) => item.severity <= 2);
  const severity = severityGate(result.findings, Math.min(2, gates.analyzerFailSeverity));
  result.gates = [countGate('blockingFindings', blocking.length, 0), severity.gate];
  result.raw = {
    targetOrg,
    org,
    production: production.production,
    probes,
    findingCounts: {
      critical: result.findings.filter((item) => item.severity === 1).length,
      high: result.findings.filter((item) => item.severity === 2).length,
      moderate: result.findings.filter((item) => item.severity === 3).length,
    },
  };
  result.detail = `${probes.filter((p) => p.status === STATUS.PASS).length}/${probes.length} probes passed, ${blocking.length} blocking findings`;

  const probeFailed = probes.some((probe) => probe.status === STATUS.FAIL);
  if (blocking.length > 0 || probeFailed) {
    return fail(result, result.detail);
  }
  return result;
}
