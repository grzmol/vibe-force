#!/usr/bin/env node
'use strict';
/**
 * PreToolUse / Write|Edit: metadata write gate.
 *
 * Blocks writes to generated paths, secrets in source, cross-slice edits during
 * a parallel wave, and files another live agent already claimed. Advisory notes
 * (missing test, SOQL in loop, api version drift) ride back as context.
 *
 * Also matched on Read, where it blocks whole-file reads of large metadata XML
 * and points at scripts/vf-xml.js instead. Rule logic lives in
 * scripts/lib/edit-guards.js.
 */

const fs = require('node:fs');
const path = require('node:path');

const io = require('../lib/hook-io');
const { loadConfig, modeEnabled } = require('../lib/config');
const { evaluateEdit, evaluateRead, DECISION } = require('../lib/edit-guards');
const state = require('../lib/state');

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch (_) {
    return 0;
  }
}

io.main((f) => {
  const writing = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(f.tool);
  if (!writing && f.tool !== 'Read') return io.pass();
  if (!f.filePath) return io.pass();

  const { config, projectRoot, stateDir } = loadConfig(f.projectDir || f.cwd);
  if (!modeEnabled(config, 'minimal')) return io.pass();

  const abs = path.isAbsolute(f.filePath) ? f.filePath : path.join(projectRoot, f.filePath);
  const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
  const target = rel.startsWith('..') ? f.filePath : rel;
  const mode0 = (config.hooks && config.hooks.mode) || 'standard';

  if (!writing) {
    // A partial read (offset/limit) is already bounded, so it costs what it says.
    const bounded = Boolean(f.input && (f.input.limit || f.input.offset));
    const verdict = evaluateRead({
      filePath: target,
      bytes: sizeOf(abs),
      config,
      mode: mode0,
      override: bounded || process.env.VF_XML_READ === '1'
    });
    if (verdict.decision !== DECISION.DENY) return io.pass();
    state.appendEvent(stateDir, { hook: 'pre-edit-guard', decision: verdict.decision, rule: verdict.rule, file: target, session: f.session, agent: f.agentType || 'main' });
    return io.deny(`vibe-force guard [${verdict.rule}]: ${verdict.reason}`);
  }

  const conflict = config.hooks && config.hooks.enforceOwnership ? state.claimConflict(stateDir, target, f.agentId || 'main') : null;

  const verdict = evaluateEdit({
    filePath: target,
    content: f.content,
    agentType: f.agentType || '',
    conflict,
    config,
    mode: (config.hooks && config.hooks.mode) || 'standard',
    anyExists: (candidates) => candidates.some((c) => fs.existsSync(path.join(projectRoot, c)))
  });

  if (verdict.decision === DECISION.DENY || verdict.decision === DECISION.ASK) {
    state.appendEvent(stateDir, {
      hook: 'pre-edit-guard',
      decision: verdict.decision,
      rule: verdict.rule,
      file: target,
      session: f.session,
      agent: f.agentType || 'main'
    });
    const message = `vibe-force guard [${verdict.rule}]: ${verdict.reason}`;
    return verdict.decision === DECISION.DENY ? io.deny(message) : io.ask(message);
  }

  const mode = (config.hooks && config.hooks.mode) || 'standard';
  if (verdict.notes.length && mode !== 'minimal') {
    return io.addContext(io.EVENT_KEYS.PreToolUse, `vibe-force notes for ${target}:\n- ${verdict.notes.join('\n- ')}`);
  }
  return io.pass();
});
