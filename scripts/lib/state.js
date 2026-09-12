'use strict';
/**
 * Session state shared between hook invocations.
 *
 * Everything lives under <project>/.vibeforce/state/ and is disposable:
 *   ownership.json   which agent claimed which metadata path (parallel-wave safety)
 *   touched.json     files edited per session, drives the Stop gate
 *   deploy-jobs.json validated deployment job ids awaiting quick deploy
 *   events.jsonl     append-only audit of guarded commands and gate results
 */

const fs = require('node:fs');
const path = require('node:path');

const CLAIM_TTL_MS = 6 * 60 * 60 * 1000;

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch (_) {
    return false;
  }
}

function read(stateDir, name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function write(stateDir, name, value) {
  if (!ensureDir(stateDir)) return false;
  const target = path.join(stateDir, name);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tmp, target);
    return true;
  } catch (_) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* ignore */
    }
    return false;
  }
}

function appendEvent(stateDir, event) {
  if (!ensureDir(stateDir)) return false;
  try {
    fs.appendFileSync(path.join(stateDir, 'events.jsonl'), `${JSON.stringify(Object.assign({ at: new Date().toISOString() }, event))}\n`);
    return true;
  } catch (_) {
    return false;
  }
}

/* ---------- ownership ---------- */

function fresh(claim) {
  return claim && Date.now() - Date.parse(claim.at || 0) < CLAIM_TTL_MS;
}

function ownership(stateDir) {
  return read(stateDir, 'ownership.json', { claims: {}, agents: {} });
}

/**
 * @returns {{agentId:string, agentType:string, at:string}|null} conflicting claim, if any
 */
function claimConflict(stateDir, filePath, agentId) {
  const store = ownership(stateDir);
  const claim = store.claims[filePath];
  if (!fresh(claim)) return null;
  if (!claim.agentId || claim.agentId === agentId) return null;
  return claim;
}

function claim(stateDir, filePath, agentId, agentType) {
  const store = ownership(stateDir);
  store.claims[filePath] = { agentId: agentId || 'main', agentType: agentType || 'main', at: new Date().toISOString() };
  const key = agentId || 'main';
  const agent = store.agents[key] || { agentType: agentType || 'main', files: [], at: new Date().toISOString() };
  if (!agent.files.includes(filePath)) agent.files.push(filePath);
  agent.agentType = agentType || agent.agentType;
  store.agents[key] = agent;
  // prune stale claims so a long-lived project state file stays small
  for (const [p, c] of Object.entries(store.claims)) if (!fresh(c)) delete store.claims[p];
  write(stateDir, 'ownership.json', store);
  return store.agents[key].files;
}

function release(stateDir, agentId) {
  const store = ownership(stateDir);
  const agent = store.agents[agentId];
  for (const [p, c] of Object.entries(store.claims)) if (c.agentId === agentId) delete store.claims[p];
  delete store.agents[agentId];
  write(stateDir, 'ownership.json', store);
  return agent ? agent.files : [];
}

/* ---------- touched files per session ---------- */

function touch(stateDir, sessionId, filePath) {
  const store = read(stateDir, 'touched.json', {});
  const list = store[sessionId] || [];
  if (!list.includes(filePath)) list.push(filePath);
  store[sessionId] = list.slice(-500);
  write(stateDir, 'touched.json', store);
  return store[sessionId];
}

function touched(stateDir, sessionId) {
  const store = read(stateDir, 'touched.json', {});
  return store[sessionId] || [];
}

function clearTouched(stateDir, sessionId) {
  const store = read(stateDir, 'touched.json', {});
  delete store[sessionId];
  write(stateDir, 'touched.json', store);
}

/* ---------- gate bookkeeping ---------- */

function setGate(stateDir, sessionId, gate) {
  const store = read(stateDir, 'gates.json', {});
  store[sessionId] = Object.assign({}, store[sessionId], gate, { at: new Date().toISOString() });
  write(stateDir, 'gates.json', store);
  return store[sessionId];
}

function getGate(stateDir, sessionId) {
  return read(stateDir, 'gates.json', {})[sessionId] || {};
}

/* ---------- validated deployments ---------- */

function deployJobs(stateDir) {
  return read(stateDir, 'deploy-jobs.json', { jobs: [] });
}

function validatedJobFor(stateDir, targetOrg) {
  const jobs = deployJobs(stateDir).jobs || [];
  return jobs
    .filter((j) => j.status === 'Succeeded' && (!targetOrg || String(j.targetOrg).toLowerCase() === String(targetOrg).toLowerCase()))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0];
}

module.exports = {
  CLAIM_TTL_MS,
  ensureDir,
  read,
  write,
  appendEvent,
  ownership,
  claim,
  claimConflict,
  release,
  touch,
  touched,
  clearTouched,
  setGate,
  getGate,
  deployJobs,
  validatedJobFor
};
