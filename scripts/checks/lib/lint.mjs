/**
 * `lint` - ESLint over LWC and Aura JavaScript.
 *
 * ESLint 9 flat config resolves shareable configs and plugins relative to the config file, so a
 * config living in the plugin directory cannot load `@salesforce/eslint-config-lwc` from the
 * consumer project. The check therefore requires a project-level config and points at
 * `config/eslint/eslint.config.mjs` as the file to copy when none exists.
 *
 * Docs: https://eslint.org/docs/latest/use/command-line-interface
 */

import fs from 'node:fs';
import path from 'node:path';
import { byExtension, resolveTargets, underAnyGlob } from './files.mjs';
import { countGate } from './gates.mjs';
import { fail, finding, makeResult, skip } from './result.mjs';
import { exec, extractJson, installHint, isToolMissing, resolveNodeTool } from './run.mjs';

const CONFIG_NAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  '.eslintrc',
];

function projectConfig(projectRoot) {
  for (const name of CONFIG_NAMES) {
    const candidate = path.join(projectRoot, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function run(ctx) {
  const result = makeResult('lint');
  const targets = await resolveTargets(ctx);
  if (targets.warning) ctx.log.warn(targets.warning);

  const extensions = ctx.config.lint?.extensions ?? ['.js', '.mjs', '.cjs', '.ts'];
  const globs = ctx.config.lint?.includeGlobs ?? ['**/lwc/**', '**/aura/**'];
  const files = underAnyGlob(byExtension(targets.files, extensions), globs).filter(
    (file) => !file.includes('/node_modules/'),
  );

  if (files.length === 0) {
    return skip(result, `no LWC or Aura JavaScript in scope (${targets.mode})`);
  }

  const config = projectConfig(ctx.projectRoot);
  if (!config) {
    return skip(
      result,
      'no project ESLint config',
      `Copy ${path.join(ctx.pluginRoot, 'config', 'eslint', 'eslint.config.mjs')} to ${ctx.projectRoot}/eslint.config.mjs and install its peer plugins. ESLint resolves plugins relative to the config file, so the packaged copy cannot be used in place.`,
    );
  }

  const tool = resolveNodeTool({ config: ctx.config, projectRoot: ctx.projectRoot, key: 'eslint', tool: 'eslint' });
  const maxWarnings = ctx.config.lint?.maxWarnings ?? 0;
  const args = [
    ...tool.prefix,
    '--format',
    'json',
    '--no-error-on-unmatched-pattern',
    ...(ctx.args.fix ? ['--fix'] : []),
    ...files,
  ];

  const res = await exec(tool.bin, args, { cwd: ctx.projectRoot, env: ctx.env, timeoutMs: 300000 });

  result.raw = {
    command: [tool.bin, ...tool.prefix, 'eslint', '--format json'].join(' '),
    fileCount: files.length,
    mode: targets.mode,
    configFile: path.relative(ctx.projectRoot, config),
    exitCode: res.code,
  };

  if (isToolMissing(res)) {
    return skip(result, 'eslint is not available', installHint('eslint'));
  }
  if (res.timedOut) {
    return fail(result, 'eslint timed out after 300s');
  }
  if (/Cannot find (package|module)/i.test(res.stderr)) {
    return skip(
      result,
      'eslint cannot load its plugins',
      installHint('eslint'),
    );
  }

  const payload = extractJson(res.stdout);
  if (!Array.isArray(payload)) {
    return fail(
      result,
      `eslint produced no JSON report (exit ${res.code}): ${res.stderr.trim().split('\n').slice(-3).join(' ')}`,
    );
  }

  let errors = 0;
  let warnings = 0;
  let fixed = 0;
  for (const entry of payload) {
    const relative = path.relative(ctx.projectRoot, entry.filePath).split(path.sep).join('/');
    if (entry.output) fixed += 1;
    for (const message of entry.messages ?? []) {
      const isError = message.severity === 2;
      if (isError) errors += 1;
      else warnings += 1;
      result.findings.push(
        finding({
          severity: isError ? 2 : 4,
          file: relative,
          line: message.line ?? null,
          rule: message.ruleId ?? (message.fatal ? 'eslint/parse-error' : 'eslint'),
          engine: 'eslint',
          message: message.message,
        }),
      );
    }
  }

  result.gates = [countGate('eslintErrors', errors, 0), countGate('eslintWarnings', warnings, maxWarnings)];
  result.detail = `${files.length} files, ${errors} errors, ${warnings} warnings${ctx.args.fix ? `, ${fixed} autofixed` : ''}`;
  result.raw.counts = { errors, warnings, files: files.length };

  if (errors > 0 || warnings > maxWarnings) return fail(result, result.detail);
  return result;
}
