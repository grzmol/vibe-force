#!/usr/bin/env node
'use strict';
/**
 * SessionStart: inject the Salesforce context the session needs up front.
 *
 * Keeps it short on purpose: project shape, api version drift, default org,
 * gate configuration, pending validated deployments, and the entry commands.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const io = require('../lib/hook-io');
const { loadConfig, modeEnabled } = require('../lib/config');
const state = require('../lib/state');

function countFiles(root, dirs, matcher, cap = 5000) {
  let count = 0;
  const stack = dirs.map((d) => path.join(root, d));
  while (stack.length && count < cap) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        stack.push(full);
      } else if (matcher(entry.name)) {
        count += 1;
      }
    }
  }
  return count;
}

function defaultOrg(projectRoot) {
  const res = spawnSync('sf', ['config', 'get', 'target-org', '--json'], { cwd: projectRoot, timeout: 8000, encoding: 'utf8' });
  if (res.error || res.status !== 0 || !res.stdout) return { alias: null, cliMissing: Boolean(res.error && res.error.code === 'ENOENT') };
  try {
    const parsed = JSON.parse(res.stdout);
    const row = (parsed.result || [])[0] || {};
    return { alias: row.value || null, cliMissing: false };
  } catch (_) {
    return { alias: null, cliMissing: false };
  }
}

io.main((f) => {
  const { config, projectRoot, hasProject, stateDir } = loadConfig(f.projectDir || f.cwd);
  if (!modeEnabled(config, 'minimal')) return io.pass();
  if (!hasProject) return io.pass();

  const lines = [];
  let projectJson = {};
  try {
    projectJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'sfdx-project.json'), 'utf8'));
  } catch (_) {
    /* ignore */
  }
  const packageDirs = (projectJson.packageDirectories || []).map((p) => p.path).filter(Boolean);
  const dirs = packageDirs.length ? packageDirs : config.packageDirectories || ['force-app'];

  lines.push(`project: ${path.basename(projectRoot)} | package dirs: ${dirs.join(', ')}`);
  const sourceApi = projectJson.sourceApiVersion;
  if (sourceApi && config.apiVersion && sourceApi !== config.apiVersion) {
    lines.push(`api version: sfdx-project.json ${sourceApi} vs vibe-force ${config.apiVersion} - reconcile before deploying`);
  } else {
    lines.push(`api version: ${sourceApi || config.apiVersion}`);
  }

  lines.push(
    `metadata: ${countFiles(projectRoot, dirs, (n) => n.endsWith('.cls'))} apex classes, ` +
      `${countFiles(projectRoot, dirs, (n) => n.endsWith('.trigger'))} triggers, ` +
      `${countFiles(projectRoot, dirs, (n) => n.endsWith('.js-meta.xml'))} lwc bundles, ` +
      `${countFiles(projectRoot, dirs, (n) => n.endsWith('.flow-meta.xml'))} flows`
  );

  const org = defaultOrg(projectRoot);
  if (org.cliMissing) lines.push('salesforce cli: NOT on PATH - install `@salesforce/cli`; org-touching checks will fail with exit 2');
  else lines.push(`default org: ${org.alias || 'none set (`sf config set target-org <alias>`)'}`);

  const g = config.gates || {};
  lines.push(`gates: apex org ${g.apexOrgCoverageMin}% / class ${g.apexClassCoverageMin}%, jest ${g.jestCoverageMin}%, analyzer fails at severity ${g.analyzerFailSeverity}`);
  lines.push(`hook mode: ${config.hooks.mode} | production aliases guarded: ${(config.productionAliases || []).join(', ') || 'none'}`);

  const pending = (state.deployJobs(stateDir).jobs || []).filter((j) => j.status === 'Succeeded');
  if (pending.length) {
    const latest = pending[pending.length - 1];
    lines.push(`validated deployment awaiting quick deploy: job ${latest.jobId} -> ${latest.targetOrg} (validated ${latest.createdAt})`);
  }

  const claims = Object.entries(state.ownership(stateDir).claims || {});
  if (claims.length) lines.push(`${claims.length} metadata path(s) still claimed by a previous wave; claims expire after 6h`);

  lines.push('entry points: /vf-story for the full parallel workflow, /vf-check for gates, /vf-deploy for validate+quick deploy, /vf-verify after deploy');
  lines.push(
    `metadata xml: read it with /vf-xml (outline, get, set - whole-file reads over ${Math.round(((config.xml && config.xml.readMaxBytes) || 20000) / 1024)} kB are denied), ` +
      'migrate workflow rules with /vf-migrate-workflow'
  );

  return io.addContext(io.EVENT_KEYS.SessionStart, `vibe-force context\n${lines.map((l) => `- ${l}`).join('\n')}`);
});
