/**
 * `format` - prettier over changed Apex, LWC, XML and JS files.
 *
 * Prettier resolves the `plugins` entries of a configuration file relative to that file, so the
 * packaged `config/prettier/.prettierrc` only works when the consumer project has installed
 * prettier-plugin-apex and @prettier/plugin-xml. The project's own prettier config wins when it
 * exists; otherwise the packaged one is passed with `--config` and a plugin-resolution failure is
 * reported as a skip with a copy instruction.
 *
 * Docs: https://prettier.io/docs/en/cli (--check, --ignore-path, --config)
 */

import fs from 'node:fs';
import path from 'node:path';
import { byExtension, resolveTargets } from './files.mjs';
import { countGate } from './gates.mjs';
import { STATUS, fail, makeResult, finding, skip } from './result.mjs';
import { exec, installHint, isToolMissing, resolveNodeTool } from './run.mjs';

const PROJECT_CONFIG_NAMES = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.json5',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  '.prettierrc.js',
  '.prettierrc.mjs',
  '.prettierrc.cjs',
  'prettier.config.js',
  'prettier.config.mjs',
  'prettier.config.cjs',
];

function projectConfig(projectRoot) {
  for (const name of PROJECT_CONFIG_NAMES) {
    const candidate = path.join(projectRoot, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    if (pkg.prettier) return path.join(projectRoot, 'package.json');
  } catch {
    // No package.json, or it is unreadable; fall back to the packaged config.
  }
  return null;
}

function ignorePaths(ctx) {
  const paths = [];
  for (const name of ['.gitignore', '.prettierignore']) {
    const candidate = path.join(ctx.projectRoot, name);
    if (fs.existsSync(candidate)) paths.push(candidate);
  }
  paths.push(path.join(ctx.pluginRoot, 'config', 'prettier', '.prettierignore'));
  return paths;
}

export async function run(ctx) {
  const result = makeResult('format');
  const targets = await resolveTargets(ctx);
  if (targets.warning) ctx.log.warn(targets.warning);

  const extensions = ctx.config.format?.extensions ?? ['.cls', '.trigger', '.js', '.html', '.xml'];
  const maxFiles = ctx.config.format?.maxFiles ?? 400;
  let files = byExtension(targets.files, extensions);

  if (files.length === 0) {
    return skip(result, `no formattable files (${targets.mode})`);
  }
  if (files.length > maxFiles) {
    ctx.log.warn(`${files.length} files matched; formatting the first ${maxFiles} (format.maxFiles)`);
    files = files.slice(0, maxFiles);
  }

  const tool = resolveNodeTool({ config: ctx.config, projectRoot: ctx.projectRoot, key: 'prettier', tool: 'prettier' });
  const config = projectConfig(ctx.projectRoot);
  const args = [
    ...tool.prefix,
    ctx.args.fix ? '--write' : '--check',
    '--config',
    config ?? path.join(ctx.pluginRoot, 'config', 'prettier', '.prettierrc'),
    ...ignorePaths(ctx).flatMap((value) => ['--ignore-path', value]),
    '--no-error-on-unmatched-pattern',
    ...files,
  ];

  const res = await exec(tool.bin, args, {
    cwd: ctx.projectRoot,
    env: ctx.env,
    timeoutMs: 300000,
  });

  result.raw = {
    command: [tool.bin, ...args.slice(0, args.length - files.length)].join(' '),
    fileCount: files.length,
    mode: targets.mode,
    configSource: config ? 'project' : 'plugin',
    exitCode: res.code,
  };

  if (isToolMissing(res)) {
    return skip(result, 'prettier is not available', installHint('prettier'));
  }
  if (/Cannot find (package|module)/i.test(res.stderr)) {
    return skip(
      result,
      'prettier cannot load its plugins',
      `Install the formatter plugins in the project (npm install --save-dev prettier prettier-plugin-apex @prettier/plugin-xml), or copy ${path.join(ctx.pluginRoot, 'config', 'prettier', '.prettierrc')} to the project root.`,
    );
  }
  if (res.timedOut) {
    return fail(result, 'prettier timed out after 300s');
  }

  const offenders = res.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('[warn] '))
    .map((line) => line.slice('[warn] '.length))
    .filter((line) => !/^Code style issues/i.test(line) && !/^Ignored unknown option/i.test(line));

  for (const file of offenders) {
    result.findings.push(
      finding({
        severity: 4,
        file,
        rule: 'prettier/format',
        engine: 'prettier',
        message: ctx.args.fix ? 'reformatted' : 'not formatted; run vf-check format --fix',
      }),
    );
  }

  if (ctx.args.fix) {
    result.detail = `${files.length} files processed, ${offenders.length} rewritten`;
    result.gates = [];
    return result;
  }

  result.gates = [countGate('unformatted', offenders.length, 0)];
  result.detail = `${files.length} files checked, ${offenders.length} unformatted`;

  if (res.code !== 0 && offenders.length === 0) {
    // Non-zero without a file list means prettier itself failed (syntax error, bad option).
    return fail(result, `prettier exited ${res.code}: ${res.stderr.trim().split('\n').slice(-3).join(' ')}`);
  }
  if (offenders.length > 0) return fail(result, result.detail);

  result.status = STATUS.PASS;
  return result;
}
