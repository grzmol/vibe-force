/**
 * Process execution helpers. Every external tool call in the runner goes through `exec`, so
 * timeouts, output capture, JSON extraction and missing-tool detection behave identically
 * everywhere.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EXIT, VfError } from './result.mjs';

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

const MISSING_PATTERNS = [
  /command not found/i,
  /is not recognized as an internal or external command/i,
  /no such file or directory/i,
  /npx canceled due to missing packages/i,
  /could not determine executable to run/i,
  /Warning: .* is not a recognized command/i,
];

function capture(chunks, chunk) {
  const size = chunks.reduce((total, piece) => total + piece.length, 0);
  if (size >= MAX_CAPTURE_BYTES) return;
  chunks.push(chunk);
}

/**
 * Runs a command without a shell.
 * @returns {Promise<{bin:string,args:string[],code:number|null,signal:string|null,stdout:string,
 *   stderr:string,timedOut:boolean,spawnError:Error|null,durationMs:number}>}
 */
export function exec(bin, args, { cwd = process.cwd(), env = process.env, timeoutMs = 600000, input = null } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(bin, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let timedOut = false;
    let settled = false;

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 5000).unref?.();
          }, timeoutMs)
        : null;

    const done = (patch) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        bin,
        args,
        code: null,
        signal: null,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
        spawnError: null,
        durationMs: Date.now() - started,
        ...patch,
      });
    };

    child.stdout.on('data', (chunk) => capture(out, chunk));
    child.stderr.on('data', (chunk) => capture(err, chunk));
    child.on('error', (error) => done({ code: null, spawnError: error }));
    child.on('close', (code, signal) => done({ code, signal }));

    if (input !== null) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

export function isToolMissing(res) {
  if (res.spawnError && ['ENOENT', 'EACCES'].includes(res.spawnError.code)) return true;
  if (res.code === 127) return true;
  const text = `${res.stderr}\n${res.stdout}`;
  return MISSING_PATTERNS.some((pattern) => pattern.test(text));
}

export function commandLine(res) {
  return [res.bin, ...res.args].join(' ');
}

/** Pulls the outermost JSON value out of mixed output (CLI banners, npm notices, progress bars). */
export function extractJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ]) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) {
      const candidate = tryParse(trimmed.slice(start, end + 1));
      if (candidate !== undefined) return candidate;
    }
  }
  return null;
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function execJson(bin, args, opts = {}) {
  const res = await exec(bin, args, opts);
  return { ...res, json: extractJson(res.stdout) ?? extractJson(res.stderr) };
}

/** Tool name -> install instruction shown when the binary is missing. */
const INSTALL_HINTS = {
  sf: 'Install Salesforce CLI v2: npm install --global @salesforce/cli (https://developer.salesforce.com/tools/salesforcecli)',
  git: 'Install git, or run the check without --changed.',
  prettier:
    'Add the formatter to the project: npm install --save-dev prettier prettier-plugin-apex @prettier/plugin-xml',
  eslint:
    'Add the linter to the project: npm install --save-dev eslint @salesforce/eslint-config-lwc @lwc/eslint-plugin-lwc @salesforce/eslint-plugin-lightning eslint-plugin-import eslint-plugin-jest',
  'sfdx-lwc-jest': 'Add LWC unit testing: npm install --save-dev @salesforce/sfdx-lwc-jest',
  npx: 'Install Node.js 20 or later (npx ships with npm).',
  node: 'Install Node.js 20 or later.',
};

export function installHint(tool) {
  return INSTALL_HINTS[tool] ?? `Install ${tool} and make sure it is on PATH.`;
}

/**
 * Resolves how to invoke a JavaScript dev tool:
 *   1. `config.tooling[<key>]` when it is an absolute path or contains a separator
 *   2. `<project>/node_modules/.bin/<tool>`
 *   3. `npx --no-install <tool>` so a missing dependency fails fast instead of downloading
 */
export function resolveNodeTool({ config, projectRoot, key, tool }) {
  const override = config?.tooling?.[key];
  if (override && (path.isAbsolute(override) || override.includes(path.sep))) {
    return { bin: override, prefix: [], tool, source: 'config' };
  }
  const name = override || tool;
  const local = path.join(projectRoot, 'node_modules', '.bin', name);
  if (fs.existsSync(local)) return { bin: local, prefix: [], tool: name, source: 'node_modules' };
  const npx = config?.tooling?.npx || 'npx';
  return { bin: npx, prefix: ['--no-install', name], tool: name, source: 'npx' };
}

/** Salesforce CLI, git and node are expected on PATH; only the binary name is configurable. */
export function resolveBin(config, key, fallback = key) {
  return config?.tooling?.[key] || fallback;
}

export function assertNoSpawnFailure(res, tool) {
  if (res.spawnError && !['ENOENT', 'EACCES'].includes(res.spawnError.code)) {
    throw new VfError(`Failed to run ${tool}: ${res.spawnError.message}`, EXIT.CONFIG);
  }
}
