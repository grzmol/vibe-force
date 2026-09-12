/**
 * Project discovery and configuration loading.
 *
 * Precedence for the project root:
 *   1. --project-dir
 *   2. $CLAUDE_PROJECT_DIR
 *   3. nearest ancestor of cwd containing sfdx-project.json
 *   4. cwd
 *
 * Configuration is `<project>/.vibeforce/config.json` merged over
 * `<plugin>/config/vibe-force.defaults.json`. The merge is shallow per top-level key; when both
 * sides hold a plain object the object's own keys are merged one level deeper (so a project can
 * override `gates.jestCoverageMin` without restating every gate). Arrays always replace.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EXIT, VfError } from './result.mjs';

export const DEFAULTS_RELATIVE = path.join('config', 'vibe-force.defaults.json');
export const PROJECT_CONFIG_RELATIVE = path.join('.vibeforce', 'config.json');

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new VfError(`Cannot read ${file}: ${err.message}`, EXIT.CONFIG);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new VfError(
      `${file} is not valid JSON: ${err.message}`,
      EXIT.CONFIG,
      'Fix the JSON syntax, then rerun. Comments and trailing commas are not allowed.',
    );
  }
}

export function findProjectRoot({ explicit = null, env = process.env, cwd = process.cwd() } = {}) {
  const candidate = explicit || env.CLAUDE_PROJECT_DIR || null;
  if (candidate) {
    const resolved = path.resolve(candidate);
    if (!fs.existsSync(resolved)) {
      throw new VfError(
        `Project directory does not exist: ${resolved}`,
        EXIT.CONFIG,
        'Pass an existing path with --project-dir, or unset CLAUDE_PROJECT_DIR.',
      );
    }
    return resolved;
  }

  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'sfdx-project.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(cwd);
}

export function loadConfig({ pluginRoot, projectRoot }) {
  const defaultsPath = path.join(pluginRoot, DEFAULTS_RELATIVE);
  if (!fs.existsSync(defaultsPath)) {
    throw new VfError(
      `Missing plugin defaults at ${defaultsPath}`,
      EXIT.CONFIG,
      'The vibe-force plugin checkout is incomplete. Reinstall the plugin.',
    );
  }
  const defaults = readJson(defaultsPath);

  const projectPath = path.join(projectRoot, PROJECT_CONFIG_RELATIVE);
  const project = fs.existsSync(projectPath) ? readJson(projectPath) : null;

  const merged = { ...defaults };
  for (const [key, value] of Object.entries(project ?? {})) {
    if (key.startsWith('$')) continue;
    merged[key] =
      isPlainObject(value) && isPlainObject(defaults[key]) ? { ...defaults[key], ...value } : value;
  }

  merged.__sources = {
    defaults: defaultsPath,
    project: project ? projectPath : null,
  };
  return merged;
}

/**
 * Package directories, preferring sfdx-project.json (the file Salesforce CLI itself reads) and
 * falling back to config.packageDirectories.
 */
export function packageDirectories({ projectRoot, config }) {
  const sfdxProject = path.join(projectRoot, 'sfdx-project.json');
  if (fs.existsSync(sfdxProject)) {
    try {
      const parsed = readJson(sfdxProject);
      const dirs = (parsed.packageDirectories ?? [])
        .map((entry) => entry?.path)
        .filter((value) => typeof value === 'string' && value.length > 0);
      if (dirs.length > 0) return dirs;
    } catch {
      // Fall through to configured defaults; `static` reports the malformed file separately.
    }
  }
  return config.packageDirectories ?? ['force-app'];
}

export function hasSfdxProject(projectRoot) {
  return fs.existsSync(path.join(projectRoot, 'sfdx-project.json'));
}

export function requireSfdxProject(projectRoot) {
  if (!hasSfdxProject(projectRoot)) {
    throw new VfError(
      `No sfdx-project.json found at ${projectRoot}`,
      EXIT.CONFIG,
      'Run this check from a Salesforce DX project, pass --project-dir <path>, or scaffold one with the /vf-init command.',
    );
  }
}

/** Reads an env override that must be exactly "1" to take effect. */
export function envFlag(env, name) {
  return String(env[name] ?? '') === '1';
}
