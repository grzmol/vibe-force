#!/usr/bin/env node
'use strict';
/**
 * PreCompact: persist the delivery state that must survive compaction.
 *
 * Writes .vibeforce/state/session-notes.md with the touched metadata, the last
 * gate result, validated deployments awaiting a quick deploy, and live claims,
 * then points the compacted context at that file.
 */

const fs = require('node:fs');
const path = require('node:path');

const io = require('../lib/hook-io');
const { loadConfig, modeEnabled } = require('../lib/config');
const state = require('../lib/state');

io.main((f) => {
  const { config, projectRoot, stateDir, hasProject } = loadConfig(f.projectDir || f.cwd);
  if (!hasProject) return io.pass();
  if (!modeEnabled(config, 'minimal')) return io.pass();

  const touched = state.touched(stateDir, f.session);
  const gate = state.getGate(stateDir, f.session);
  const jobs = (state.deployJobs(stateDir).jobs || []).filter((j) => j.status === 'Succeeded');
  const claims = Object.entries(state.ownership(stateDir).claims || {});

  const lines = [
    '# vibe-force session notes',
    '',
    `generated: ${new Date().toISOString()}`,
    `session: ${f.session}`,
    '',
    `## Touched metadata (${touched.length})`,
    ...(touched.length ? touched.map((t) => `- ${t}`) : ['- none']),
    '',
    '## Last local gate',
    gate.status ? `- ${gate.gate || 'static'}: ${gate.status}${gate.exitCode ? ` (exit ${gate.exitCode})` : ''} at ${gate.at}` : '- not run in this session',
    '',
    '## Validated deployments awaiting quick deploy',
    ...(jobs.length ? jobs.map((j) => `- job ${j.jobId} -> ${j.targetOrg}, validated ${j.createdAt}, test level ${j.testLevel || 'unknown'}`) : ['- none']),
    '',
    `## Live metadata claims (${claims.length})`,
    ...(claims.length ? claims.map(([p, c]) => `- ${p} -> ${c.agentType || c.agentId}`) : ['- none']),
    ''
  ];

  const target = path.join(stateDir, 'session-notes.md');
  if (state.ensureDir(stateDir)) {
    try {
      fs.writeFileSync(target, lines.join('\n'));
    } catch (_) {
      return io.pass();
    }
  }

  const rel = path.relative(projectRoot, target).split(path.sep).join('/');
  return io.addContext(io.EVENT_KEYS.PreCompact, `vibe-force delivery state persisted to ${rel}: ${touched.length} touched file(s), last gate ${gate.status || 'not run'}, ${jobs.length} validated deployment(s) pending. Read that file after compaction instead of re-deriving state.`);
});
