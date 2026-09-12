/**
 * `analyzer` - Salesforce Code Analyzer v5.
 *
 *   sf code-analyzer run --workspace <dir> [--target <file>...] --rule-selector <sel>
 *     --severity-threshold <n> --config-file <yml> --output-file <json> --view table
 *
 * The JSON output file schema is
 * `{runDir, violationCounts:{total,sev1..sev5}, versions, violations:[{rule,engine,severity,tags,
 * primaryLocationIndex,locations:[{file,startLine,startColumn}],message,resources}]}`.
 * Docs: https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/output-schemas-json.html
 *
 * The packaged config/code-analyzer.yml adds the curated PMD ruleset (tag `VibeForceApexRules`)
 * and vibe-force regex rules (tag `VibeForce`), which is why the default rule selector is
 * `(Recommended,VibeForceApexRules,VibeForce)` - inside parentheses commas are logical ORs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packageDirectories } from './config.mjs';
import { resolveTargets } from './files.mjs';
import { gateConfig, severityGate } from './gates.mjs';
import { fail, finding, makeResult, skip } from './result.mjs';
import { exec, installHint, isToolMissing, resolveBin } from './run.mjs';

const ANALYZABLE = new Set([
  '.cls',
  '.trigger',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.html',
  '.htm',
  '.cmp',
  '.page',
  '.component',
  '.xml',
  '.css',
  '.apex',
]);

function configFile(ctx) {
  for (const name of ['code-analyzer.yml', 'code-analyzer.yaml']) {
    const candidate = path.join(ctx.projectRoot, name);
    if (fs.existsSync(candidate)) return { file: candidate, source: 'project' };
  }
  return { file: path.join(ctx.pluginRoot, 'config', 'code-analyzer.yml'), source: 'plugin' };
}

export async function run(ctx) {
  const result = makeResult('analyzer');
  const gates = gateConfig(ctx.config);
  const targets = await resolveTargets(ctx);
  if (targets.warning) ctx.log.warn(targets.warning);

  const pkgDirs = packageDirectories(ctx).filter((dir) => fs.existsSync(path.join(ctx.projectRoot, dir)));
  if (pkgDirs.length === 0) {
    return skip(
      result,
      'no package directories on disk',
      `Expected one of ${(ctx.config.packageDirectories ?? []).join(', ') || 'force-app'} under ${ctx.projectRoot}.`,
    );
  }

  const scoped = targets.mode === 'all' ? [] : targets.files.filter((file) => ANALYZABLE.has(path.extname(file)));
  if (targets.mode !== 'all' && scoped.length === 0) {
    return skip(result, `no analyzable files in scope (${targets.mode})`);
  }

  const { file: config, source: configSource } = configFile(ctx);
  const workspace = (ctx.config.analyzer?.workspace?.length ? ctx.config.analyzer.workspace : pkgDirs).flatMap(
    (dir) => ['--workspace', dir],
  );
  const selectors = (ctx.config.analyzer?.ruleSelectors ?? ['Recommended']).flatMap((selector) => [
    '--rule-selector',
    selector,
  ]);
  const outputFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'vf-analyzer-')),
    'code-analyzer-results.json',
  );

  const args = [
    'code-analyzer',
    'run',
    ...workspace,
    ...scoped.flatMap((file) => ['--target', file]),
    ...selectors,
    '--severity-threshold',
    String(gates.analyzerFailSeverity),
    '--config-file',
    config,
    '--output-file',
    outputFile,
    '--view',
    ctx.config.analyzer?.view ?? 'table',
  ];

  const res = await exec(resolveBin(ctx.config, 'sf'), args, {
    cwd: ctx.projectRoot,
    env: ctx.env,
    timeoutMs: (ctx.config.analyzer?.timeoutSeconds ?? 900) * 1000,
  });

  result.raw = {
    command: ['sf', ...args].join(' '),
    configSource,
    mode: targets.mode,
    targetCount: scoped.length,
    exitCode: res.code,
  };

  if (isToolMissing(res)) {
    return skip(result, 'Salesforce CLI (sf) is not available', installHint('sf'));
  }
  if (res.timedOut) {
    return fail(result, `code-analyzer timed out after ${ctx.config.analyzer?.timeoutSeconds ?? 900}s`);
  }

  let payload = null;
  if (fs.existsSync(outputFile)) {
    try {
      payload = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    } catch (err) {
      result.raw.parseError = err.message;
    }
    fs.rmSync(path.dirname(outputFile), { recursive: true, force: true });
  }

  if (!payload) {
    const stderr = res.stderr.trim();
    if (/java|jdk/i.test(stderr) && /not found|unable|cannot/i.test(stderr)) {
      return skip(
        result,
        'Code Analyzer needs a JDK for the PMD engine',
        'Install JDK 11 or later, or set engines.pmd.disable_engine: true in code-analyzer.yml.',
      );
    }
    if (res.code === 0) {
      return skip(result, 'code-analyzer produced no result file', 'Run the command manually to inspect the failure.');
    }
    return fail(result, `code-analyzer exited ${res.code}: ${stderr.split('\n').slice(-3).join(' ')}`);
  }

  const runDir = payload.runDir ?? `${ctx.projectRoot}${path.sep}`;
  for (const violation of payload.violations ?? []) {
    const locations = violation.locations ?? [];
    const primary = locations[violation.primaryLocationIndex ?? 0] ?? locations[0] ?? {};
    const absolute = primary.file ? path.resolve(runDir, primary.file) : null;
    result.findings.push(
      finding({
        severity: violation.severity,
        file: absolute ? path.relative(ctx.projectRoot, absolute).split(path.sep).join('/') : null,
        line: primary.startLine ?? null,
        rule: violation.rule,
        engine: violation.engine,
        message: violation.message,
        extra: violation.resources?.length ? { resources: violation.resources.slice(0, 2) } : null,
      }),
    );
  }

  const { gate, blocking, threshold } = severityGate(result.findings, gates.analyzerFailSeverity);
  result.gates = [gate];
  result.raw.violationCounts = payload.violationCounts ?? null;
  result.raw.versions = payload.versions ?? null;
  result.detail = `${result.findings.length} violations, ${blocking.length} at severity <= ${threshold}`;

  if (blocking.length > 0) return fail(result, result.detail);
  return result;
}
