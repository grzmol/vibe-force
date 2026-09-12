#!/usr/bin/env node
'use strict';
/**
 * Stop: refuse to end a turn that leaves Salesforce source failing the local gate.
 *
 * Runs the configured gate (`hooks.stopGate`, default `static`) over the files
 * touched during this session only. Fails open on tooling problems unless the
 * hook mode is `strict`, so a missing prettier install cannot wedge a session.
 *
 * Escape hatches: VF_SKIP_CHECKS=1, hooks.mode=off|minimal, hooks.stopGate=none.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const io = require('../lib/hook-io');
const { loadConfig, modeEnabled, PLUGIN_ROOT } = require('../lib/config');
const { classify } = require('../lib/sf-paths');
const state = require('../lib/state');

function summarise(report) {
  if (!report || typeof report !== 'object') return '';
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const top = findings.slice(0, 12).map((x) => `  ${x.severity || '?'} ${x.file || ''}${x.line ? `:${x.line}` : ''} ${x.rule || ''} ${x.message || ''}`.trim());
  const gates = report.gates ? Object.entries(report.gates).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : '';
  return [top.join('\n'), findings.length > 12 ? `  ... ${findings.length - 12} more` : '', gates ? `gates: ${gates}` : ''].filter(Boolean).join('\n');
}

io.main((f) => {
  if (process.env.VF_SKIP_CHECKS === '1') return io.pass();
  if (f.payload && f.payload.stop_hook_active) return io.pass();

  const { config, projectRoot, stateDir, hasProject } = loadConfig(f.projectDir || f.cwd);
  if (!hasProject) return io.pass();
  if (!modeEnabled(config, 'standard')) return io.pass();

  const gateName = (config.hooks && config.hooks.stopGate) || 'static';
  if (gateName === 'none') return io.pass();

  const touched = state
    .touched(stateDir, f.session)
    .filter((rel) => {
      const info = classify(rel);
      return (info.isApex || info.isLwc || info.isMetadataXml) && !info.generated;
    })
    .filter((rel) => fs.existsSync(path.join(projectRoot, rel)));

  if (!touched.length) return io.pass();

  const previous = state.getGate(stateDir, f.session);
  if (previous.status === 'pass' && previous.signature === touched.join('|')) return io.pass();

  const runner = path.join(PLUGIN_ROOT, 'scripts', 'checks', 'vf-check.mjs');
  if (!fs.existsSync(runner)) return io.pass();

  const res = spawnSync(process.execPath, [runner, gateName, '--files', touched.join(','), '--json', '--project-dir', projectRoot], {
    cwd: projectRoot,
    timeout: (config.hooks && config.hooks.stopTimeoutSec ? config.hooks.stopTimeoutSec : 240) * 1000,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });

  let report = null;
  if (res.stdout) {
    try {
      report = JSON.parse(res.stdout);
    } catch (_) {
      /* non-JSON output: fall back to raw text */
    }
  }

  const timedOut = res.error && res.error.code === 'ETIMEDOUT';
  if (timedOut) {
    state.setGate(stateDir, f.session, { status: 'timeout', signature: touched.join('|'), gate: gateName });
    io.note(`${gateName} gate timed out; run it manually: node "${runner}" ${gateName} --changed`);
    return io.pass();
  }

  if (res.status === 0) {
    state.setGate(stateDir, f.session, { status: 'pass', local: 'pass', signature: touched.join('|'), gate: gateName });
    return io.pass();
  }

  state.setGate(stateDir, f.session, { status: 'fail', local: 'fail', signature: touched.join('|'), gate: gateName, exitCode: res.status });
  state.appendEvent(stateDir, { hook: 'stop-local-gate', gate: gateName, exitCode: res.status, files: touched.length, session: f.session });

  // exit 2/3 mean tooling or org problems, not code problems: do not hold the turn hostage outside strict mode
  if ((res.status === 2 || res.status === 3) && (config.hooks.mode !== 'strict')) {
    io.note(`${gateName} gate could not run (exit ${res.status}). ${String(res.stderr || '').trim().split('\n')[0]}`);
    return io.pass();
  }

  const detail = summarise(report) || String(res.stdout || res.stderr || '').trim().slice(0, 2000);
  return io.block(
    `vibe-force local gate failed (${gateName}, exit ${res.status}) on ${touched.length} changed file(s). Fix these before finishing:\n${detail}\n\n` +
      `Re-run with: node "${runner}" ${gateName} --files ${touched.slice(0, 5).join(',')}${touched.length > 5 ? ',...' : ''}\n` +
      'Report: .vibeforce/reports/. Override only with an explicit human decision (VF_SKIP_CHECKS=1).'
  );
});
