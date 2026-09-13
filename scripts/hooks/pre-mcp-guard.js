#!/usr/bin/env node
'use strict';
/**
 * PreToolUse / mcp__*: the same safety rails the Bash guard applies, for MCP tool calls.
 *
 * An MCP server reaches the org directly, so nothing in scripts/lib/bash-guards.js sees it.
 * Rule logic lives in scripts/lib/mcp-guards.js.
 */

const io = require('../lib/hook-io');
const { loadConfig, modeEnabled } = require('../lib/config');
const guards = require('../lib/mcp-guards');
const state = require('../lib/state');

io.main((f) => {
  if (!f.tool.startsWith('mcp__')) return io.pass();

  const { config, stateDir } = loadConfig(f.projectDir || f.cwd);
  if (!modeEnabled(config, 'minimal')) return io.pass();

  const verdict = guards.evaluate(f.tool, f.input, {
    config,
    mode: (config.hooks && config.hooks.mode) || 'standard',
    gate: state.getGate(stateDir, f.session)
  });

  if (verdict.decision === guards.DECISION.PASS) return io.pass();

  const mode = (config.hooks && config.hooks.mode) || 'standard';
  if (verdict.decision === guards.DECISION.NOTE) {
    if (mode === 'minimal') return io.pass();
    return io.addContext(io.EVENT_KEYS.PreToolUse, `vibe-force: ${verdict.reason}`);
  }

  state.appendEvent(stateDir, {
    hook: 'pre-mcp-guard',
    decision: verdict.decision,
    rule: verdict.rule,
    session: f.session,
    agent: f.agentType || 'main',
    tool: verdict.tool,
    server: verdict.server
  });

  if (verdict.decision === guards.DECISION.DENY) return io.deny(`vibe-force guard [${verdict.rule}]: ${verdict.reason}`);
  return io.ask(`vibe-force guard [${verdict.rule}]: ${verdict.reason}`);
});
