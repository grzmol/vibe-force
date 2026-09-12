#!/usr/bin/env node
/**
 * vibe-force check runner.
 *
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" <check> [options]
 *
 * Exit codes: 0 pass, 1 gate failed, 2 misconfiguration or missing tool, 3 org/network error.
 * Every run writes <project>/.vibeforce/reports/<check>-<timestamp>.json.
 *
 * Zero npm dependencies: node: builtins only, Node 20 or later.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { envFlag, findProjectRoot, loadConfig, requireSfdxProject } from './lib/config.mjs';
import { COMPOSITES, isComposite, run as runComposite } from './lib/composite.mjs';
import { createLogger } from './lib/log.mjs';
import { buildReport, writeReport } from './lib/report.mjs';
import { EXIT, STATUS, VfError, makeResult } from './lib/result.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** check -> { org, summary, load } */
const CHECKS = {
  format: {
    org: false,
    summary: 'prettier --check on changed Apex/LWC/XML/JS',
    load: () => import('./lib/format.mjs').then((m) => m.run),
  },
  lint: {
    org: false,
    summary: 'eslint on LWC/Aura JavaScript',
    load: () => import('./lib/lint.mjs').then((m) => m.run),
  },
  analyzer: {
    org: false,
    summary: 'sf code-analyzer run, fails at gates.analyzerFailSeverity',
    load: () => import('./lib/analyzer.mjs').then((m) => m.run),
  },
  pairing: {
    org: false,
    summary: 'every Apex class has a test, every LWC has a Jest spec',
    load: () => import('./lib/pairing.mjs').then((m) => m.run),
  },
  jest: {
    org: false,
    summary: 'sfdx-lwc-jest unit tests plus coverage gate',
    load: () => import('./lib/jest.mjs').then((m) => m.run),
  },
  static: { org: false, summary: 'format + lint + analyzer + pairing', composite: true },
  local: { org: false, summary: 'static + jest (the full local gate)', composite: true },
  apex: {
    org: true,
    summary: 'sf apex run test with coverage gates',
    load: () => import('./lib/apex.mjs').then((m) => m.run),
  },
  'deploy-validate': {
    org: true,
    summary: 'sf project deploy validate (check only), records the quick-deploy job id',
    load: () => import('./lib/deploy.mjs').then((m) => m.validate),
  },
  'deploy-quick': {
    org: true,
    summary: 'sf project deploy quick --job-id <recorded id>',
    load: () => import('./lib/deploy.mjs').then((m) => m.quick),
  },
  smoke: {
    org: true,
    summary: 'post-deploy probes: deploy report, anonymous Apex, SOQL, limits, logs',
    load: () => import('./lib/smoke.mjs').then((m) => m.run),
  },
  verify: { org: true, summary: 'apex + smoke', composite: true },
  all: { org: true, summary: 'local + apex + smoke', composite: true },
};

const OPTIONS = {
  changed: { type: 'boolean', default: false },
  files: { type: 'string' },
  'target-org': { type: 'string', short: 'o' },
  env: { type: 'string' },
  json: { type: 'boolean', default: false },
  report: { type: 'string' },
  quiet: { type: 'boolean', default: false },
  fix: { type: 'boolean', default: false },
  strict: { type: 'boolean', default: false },
  'project-dir': { type: 'string' },
  'base-ref': { type: 'string' },
  tests: { type: 'string' },
  'class-names': { type: 'string' },
  'suite-names': { type: 'string' },
  'test-level': { type: 'string' },
  'job-id': { type: 'string' },
  manifest: { type: 'string' },
  'apex-file': { type: 'string' },
  'validate-strategy': { type: 'string' },
  wait: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
};

function helpText() {
  const rows = Object.entries(CHECKS).map(([name, meta]) => ({
    name,
    org: meta.org ? 'yes' : 'no',
    summary: meta.summary,
  }));
  const nameWidth = Math.max(...rows.map((row) => row.name.length), 'check'.length);
  const header = `  ${'check'.padEnd(nameWidth)}  org  what it does`;
  const divider = `  ${'-'.repeat(nameWidth)}  ---  ${'-'.repeat(46)}`;
  const table = rows.map((row) => `  ${row.name.padEnd(nameWidth)}  ${row.org.padEnd(3)}  ${row.summary}`);

  return [
    'vibe-force check runner',
    '',
    'Usage:',
    '  node scripts/checks/vf-check.mjs <check> [options]',
    '',
    'Checks:',
    header,
    divider,
    ...table,
    '',
    'Composites:',
    ...Object.entries(COMPOSITES).map(([name, steps]) => `  ${name.padEnd(nameWidth)}  = ${steps.join(' -> ')}`),
    '',
    'Options:',
    '  --changed                 only files changed vs git merge-base <base-ref> HEAD',
    '  --files <glob,...>        explicit target globs, comma separated',
    '  --target-org, -o <alias>  org alias for org-touching checks',
    '  --env <key>               pick the alias from config.orgs[<key>]',
    '  --test-level <level>      NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg|RunRelevantTests',
    '  --tests <names>           comma separated Apex test classes or Class.method entries',
    '  --class-names <names>     comma separated Apex test classes (apex check)',
    '  --suite-names <names>     comma separated Apex test suites (apex check)',
    '  --job-id <id>             deploy job id for deploy-quick and the smoke deploy probe',
    '  --manifest <path>         package.xml to deploy instead of source directories',
    '  --validate-strategy <s>   auto|validate|dry-run for deploy-validate',
    '  --apex-file <path>        anonymous Apex script for smoke',
    '  --wait <minutes>          CLI wait window for apex and deploy checks',
    '  --base-ref <ref>          git baseline for --changed (default config.git.baseRef)',
    '  --project-dir <path>      Salesforce DX project root (default: $CLAUDE_PROJECT_DIR or cwd)',
    '  --report <path>           write the JSON report to this path instead of .vibeforce/reports/',
    '  --fix                     autofix where the tool supports it (prettier, eslint, jest snapshots)',
    '  --strict                  treat a skipped step inside a composite as a failure',
    '  --json                    print the report object on stdout and nothing else',
    '  --quiet                   suppress the human summary',
    '  -h, --help                this text',
    '',
    'Exit codes:',
    '  0 pass   1 gate failed   2 misconfiguration or missing tool   3 org or network error',
    '',
    'Environment:',
    '  VF_ALLOW_PROD=1   allow org-mutating checks against a production alias',
    '  VF_SKIP_CHECKS=1  exit 0 immediately without running anything',
    '  VF_DEBUG=1        print stack traces for unexpected failures',
    '',
    'Configuration:',
    '  config/vibe-force.defaults.json  <-  <project>/.vibeforce/config.json',
    '',
  ].join('\n');
}

async function dispatch(ctx) {
  const meta = CHECKS[ctx.check];
  if (meta.composite) {
    return runComposite(ctx, {
      runStep: async (step) => {
        const stepMeta = CHECKS[step];
        const stepRun = await stepMeta.load();
        const stepCtx = { ...ctx, check: step };
        const started = Date.now();
        try {
          const stepResult = await stepRun(stepCtx);
          stepResult.durationMs = Date.now() - started;
          return stepResult;
        } catch (err) {
          if (err instanceof VfError) {
            return makeResult(step, {
              status: err.exitCode === EXIT.CONFIG ? STATUS.SKIP : STATUS.FAIL,
              exitCode: err.exitCode,
              detail: err.message,
              hint: err.hint ?? null,
              durationMs: Date.now() - started,
            });
          }
          throw err;
        }
      },
    });
  }

  const run = await meta.load();
  return run(ctx);
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n\nRun with --help for the option list.\n`);
    return EXIT.CONFIG;
  }

  const { values: args, positionals } = parsed;
  const check = positionals[0];

  if (args.help || !check) {
    process.stdout.write(`${helpText()}\n`);
    return args.help ? EXIT.PASS : EXIT.CONFIG;
  }
  if (!Object.hasOwn(CHECKS, check)) {
    process.stderr.write(
      `error: unknown check "${check}"\nhint: one of ${Object.keys(CHECKS).join(', ')}\n`,
    );
    return EXIT.CONFIG;
  }
  if (positionals.length > 1) {
    process.stderr.write(
      `error: unexpected argument "${positionals[1]}"\nhint: pass targets with --files <glob,...>\n`,
    );
    return EXIT.CONFIG;
  }

  const log = createLogger({ json: args.json, quiet: args.quiet });

  if (envFlag(process.env, 'VF_SKIP_CHECKS')) {
    log.note(`[skip] ${check} (0ms) VF_SKIP_CHECKS=1`);
    log.emitReport({ check, status: STATUS.SKIP, detail: 'VF_SKIP_CHECKS=1', findings: [], gates: [] });
    return EXIT.PASS;
  }

  const startedAt = new Date().toISOString();
  const started = Date.now();
  let projectRoot = process.cwd();
  let config = null;
  let result;

  try {
    projectRoot = findProjectRoot({ explicit: args['project-dir'] });
    requireSfdxProject(projectRoot);
    config = loadConfig({ pluginRoot: PLUGIN_ROOT, projectRoot });

    const ctx = {
      check,
      args,
      log,
      env: process.env,
      pluginRoot: PLUGIN_ROOT,
      projectRoot,
      config,
    };

    result = await dispatch(ctx);
    result.durationMs = Date.now() - started;
    if (!isComposite(check)) log.status(result);
  } catch (err) {
    const isVf = err instanceof VfError;
    if (!isVf && envFlag(process.env, 'VF_DEBUG')) process.stderr.write(`${err.stack}\n`);
    log.error(isVf ? err.message : `${err.name}: ${err.message}`, isVf ? err.hint : 'Rerun with VF_DEBUG=1 for a stack trace.');
    result = makeResult(check, {
      status: STATUS.FAIL,
      exitCode: isVf ? err.exitCode : EXIT.CONFIG,
      detail: err.message,
      durationMs: Date.now() - started,
      ...(isVf && err.hint ? { hint: err.hint } : {}),
    });
  }

  // A top-level skip means the requested check proved nothing: surface it as misconfiguration.
  if (result.status === STATUS.SKIP) {
    result.exitCode = Math.max(result.exitCode, EXIT.CONFIG);
  }

  log.findings(result.findings);
  log.gates(result.gates);

  const report = buildReport({
    check,
    startedAt,
    durationMs: result.durationMs,
    result,
    context: {
      pluginRoot: PLUGIN_ROOT,
      projectRoot,
      targetOrg: args['target-org'] ?? null,
      mode: {
        changed: Boolean(args.changed),
        files: args.files ?? null,
        fix: Boolean(args.fix),
        strict: Boolean(args.strict),
      },
      configSources: config?.__sources ?? null,
      apiVersion: config?.apiVersion ?? null,
      node: process.version,
    },
  });

  if (config) {
    try {
      const file = writeReport({ projectRoot, config, report, explicitPath: args.report ?? null });
      log.reportPath(path.relative(projectRoot, file));
    } catch (err) {
      log.warn(`could not write the report: ${err.message}`);
    }
  }

  log.emitReport(report);
  return result.exitCode;
}

process.exitCode = await main(process.argv.slice(2));
