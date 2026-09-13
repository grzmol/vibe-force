#!/usr/bin/env node
'use strict';
/**
 * PreToolUse / Bash: deterministic Salesforce safety gate.
 *
 * Blocks production deploys that skip validate + quick deploy, destructive
 * metadata and data commands, credential leakage, retired CLI syntax, and git
 * hook bypasses. Rule logic lives in scripts/lib/bash-guards.js.
 */

const fs = require('node:fs');
const path = require('node:path');

const io = require('../lib/hook-io');
const { loadConfig, modeEnabled } = require('../lib/config');
const guards = require('../lib/bash-guards');
const state = require('../lib/state');

io.main((f) => {
  if (f.tool !== 'Bash' && f.tool !== 'PowerShell') return io.pass();
  if (!f.command) return io.pass();

  const { config, projectRoot, stateDir } = loadConfig(f.projectDir || f.cwd);
  if (!modeEnabled(config, 'minimal')) return io.pass();

  const verdict = guards.evaluate(f.command, {
    config,
    mode: (config.hooks && config.hooks.mode) || 'standard',
    defaultOrg: process.env.SF_TARGET_ORG || '',
    validatedJobs: (state.deployJobs(stateDir).jobs || []),
    gate: state.getGate(stateDir, f.session),
    xmlReadOverride: process.env.VF_XML_READ === '1',
    statBytes: (file) => {
      try {
        return fs.statSync(path.isAbsolute(file) ? file : path.join(projectRoot, file)).size;
      } catch (_) {
        return 0;
      }
    }
  });

  if (verdict.decision === guards.DECISION.PASS) return io.pass();

  const mode = (config.hooks && config.hooks.mode) || 'standard';
  if (verdict.decision === guards.DECISION.NOTE) {
    if (mode === 'minimal') return io.pass();
    return io.addContext(io.EVENT_KEYS.PreToolUse, `vibe-force: ${verdict.reason}`);
  }

  state.appendEvent(stateDir, {
    hook: 'pre-bash-guard',
    decision: verdict.decision,
    rule: verdict.rule,
    session: f.session,
    agent: f.agentType || 'main',
    segment: verdict.segment
  });

  if (verdict.decision === guards.DECISION.DENY) return io.deny(`vibe-force guard [${verdict.rule}]: ${verdict.reason}`);
  return io.ask(`vibe-force guard [${verdict.rule}]: ${verdict.reason}`);
});
