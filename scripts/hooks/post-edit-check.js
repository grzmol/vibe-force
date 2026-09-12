#!/usr/bin/env node
'use strict';
/**
 * PostToolUse / Write|Edit: record the edit and check what is cheap to check.
 *
 *  - claims the path for the editing agent so parallel waves stay merge-safe
 *  - records the file in the session touch list that the Stop gate consumes
 *  - lints metadata XML well-formedness and api version drift
 *  - formats the file with the project's prettier when hooks.autoFormat is on
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const io = require('../lib/hook-io');
const { loadConfig, modeEnabled } = require('../lib/config');
const { classify, checksFor } = require('../lib/sf-paths');
const { lintXml, apiVersionOf } = require('../lib/xml-lint');
const state = require('../lib/state');

function prettierBin(projectRoot) {
  const local = path.join(projectRoot, 'node_modules', '.bin', 'prettier');
  return fs.existsSync(local) ? local : null;
}

io.main((f) => {
  if (!['Write', 'Edit', 'MultiEdit'].includes(f.tool)) return io.pass();
  if (!f.filePath) return io.pass();

  const { config, projectRoot, stateDir } = loadConfig(f.projectDir || f.cwd);
  if (!modeEnabled(config, 'minimal')) return io.pass();

  const abs = path.isAbsolute(f.filePath) ? f.filePath : path.join(projectRoot, f.filePath);
  const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
  if (rel.startsWith('..')) return io.pass();

  const info = classify(rel);
  if (info.generated) return io.pass();

  state.claim(stateDir, rel, f.agentId || 'main', f.agentType || 'main');
  state.touch(stateDir, f.session, rel);

  const notes = [];

  if (info.isMetadataXml && fs.existsSync(abs)) {
    const source = fs.readFileSync(abs, 'utf8');
    const lint = lintXml(source);
    if (!lint.ok) notes.push(`XML problems in ${rel}: ${lint.errors.join('; ')}. Fix before deploying; the Metadata API rejects the whole request.`);
    const api = apiVersionOf(source);
    if (api && config.apiVersion && api !== config.apiVersion) {
      notes.push(`${rel} declares apiVersion ${api} while the project targets ${config.apiVersion}. Align it unless the difference is deliberate.`);
    }
  }

  if (config.hooks && config.hooks.autoFormat && (info.isApex || info.isLwc || info.isMetadataXml)) {
    const bin = prettierBin(projectRoot);
    if (bin) {
      const res = spawnSync(bin, ['--write', rel], { cwd: projectRoot, timeout: 20000, encoding: 'utf8' });
      if (res.status !== 0 && res.stderr) notes.push(`prettier could not format ${rel}: ${String(res.stderr).trim().split('\n')[0]}`);
    }
  }

  const relevant = checksFor(info);
  if (relevant.length && modeEnabled(config, 'standard')) {
    notes.push(`Relevant local checks for this file: ${relevant.join(', ')} (\`node "$CLAUDE_PLUGIN_ROOT/scripts/checks/vf-check.mjs" local --changed\`).`);
  }

  if (!notes.length) return io.pass();
  return io.addContext(io.EVENT_KEYS.PostToolUse, `vibe-force:\n- ${notes.join('\n- ')}`);
});
