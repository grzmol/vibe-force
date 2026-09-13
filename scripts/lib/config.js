'use strict';
/**
 * Configuration resolution for hooks and check scripts.
 *
 * Precedence (highest first):
 *   1. VF_* environment variables
 *   2. <project>/.vibeforce/config.json
 *   3. config/vibe-force.defaults.json shipped with the plugin
 *   4. the inline FALLBACK below (plugin installed without config/, or unreadable)
 */

const fs = require('node:fs');
const path = require('node:path');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT)
  : path.resolve(__dirname, '..', '..');

const MODES = ['off', 'minimal', 'standard', 'strict'];

const FALLBACK = {
  apiVersion: '67.0',
  packageDirectories: ['force-app'],
  orgs: {},
  productionAliases: ['prod', 'production'],
  gates: {
    apexOrgCoverageMin: 85,
    apexClassCoverageMin: 75,
    jestCoverageMin: 80,
    analyzerFailSeverity: 3,
    requireTestForApexClass: true,
    requireJestForLwc: true
  },
  testLevels: { sandbox: 'RunLocalTests', production: 'RunLocalTests' },
  xml: { readMaxBytes: 20000, outlineDepth: 2 },
  hooks: {
    mode: 'standard',
    blockProductionDeploy: true,
    blockDestructive: true,
    autoFormat: true,
    enforceOwnership: true,
    stopGate: 'static'
  }
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function mergeDeep(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override === undefined ? base : override;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)) {
      out[key] = mergeDeep(current, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Nearest ancestor of `start` that looks like a Salesforce DX project. */
function findProjectRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, 'sfdx-project.json')) || fs.existsSync(path.join(dir, '.vibeforce'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start || process.cwd());
    dir = parent;
  }
}

function loadConfig(startDir) {
  const projectRoot = findProjectRoot(startDir);
  const defaults = readJson(path.join(PLUGIN_ROOT, 'config', 'vibe-force.defaults.json')) || FALLBACK;
  const project = readJson(path.join(projectRoot, '.vibeforce', 'config.json')) || {};
  const config = mergeDeep(mergeDeep(FALLBACK, defaults), project);

  if (process.env.VF_HOOK_MODE && MODES.includes(process.env.VF_HOOK_MODE)) {
    config.hooks.mode = process.env.VF_HOOK_MODE;
  }
  if (process.env.VF_ALLOW_PROD === '1') config.hooks.blockProductionDeploy = false;

  return {
    projectRoot,
    pluginRoot: PLUGIN_ROOT,
    config,
    hasProject: fs.existsSync(path.join(projectRoot, 'sfdx-project.json')),
    stateDir: path.join(projectRoot, '.vibeforce', 'state'),
    reportDir: path.join(projectRoot, '.vibeforce', 'reports')
  };
}

/** True when the hook should run at the resolved mode. */
function modeEnabled(config, minimum) {
  const mode = (config.hooks && config.hooks.mode) || 'standard';
  if (mode === 'off') return false;
  return MODES.indexOf(mode) >= MODES.indexOf(minimum);
}

/** Case-insensitive production alias test; also matches `user@prod.example.com` style values. */
function isProductionTarget(config, target) {
  if (!target) return false;
  const needle = String(target).trim().toLowerCase();
  if (!needle) return false;
  const aliases = (config.productionAliases || []).map((a) => String(a).toLowerCase());
  if (aliases.includes(needle)) return true;
  return aliases.some((alias) => alias.length > 3 && needle.includes(alias));
}

function packageGlobs(config) {
  return (config.packageDirectories || ['force-app']).map((d) => d.replace(/\/+$/, ''));
}

module.exports = { PLUGIN_ROOT, MODES, FALLBACK, loadConfig, findProjectRoot, modeEnabled, isProductionTarget, packageGlobs, mergeDeep, readJson };
