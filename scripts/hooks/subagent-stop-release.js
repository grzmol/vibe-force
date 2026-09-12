#!/usr/bin/env node
'use strict';
/**
 * SubagentStop: release the finishing agent's metadata claims.
 *
 * Wave-1 agents run in parallel over disjoint metadata paths. Claims are what
 * make that safe; leaving them behind would block the next wave, so they are
 * dropped as soon as the owning agent finishes. The claim set is recorded in
 * events.jsonl first, which is how the orchestrator reconstructs who wrote what.
 */

const io = require('../lib/hook-io');
const { loadConfig, modeEnabled } = require('../lib/config');
const state = require('../lib/state');

io.main((f) => {
  const { config, stateDir } = loadConfig(f.projectDir || f.cwd);
  if (!modeEnabled(config, 'minimal')) return io.pass();

  const agentId = f.agentId || (f.payload && f.payload.agent_id) || '';
  if (!agentId) return io.pass();

  const files = state.release(stateDir, agentId);
  if (files && files.length) {
    state.appendEvent(stateDir, {
      hook: 'subagent-stop-release',
      agent: f.agentType || agentId,
      agentId,
      session: f.session,
      files
    });
  }
  return io.pass();
});
