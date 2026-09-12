/**
 * Durable runner state under `<project>/.vibeforce/state/`.
 *
 * deploy-jobs.json records every successful `deploy-validate` so `deploy-quick` can find a job id
 * without asking the operator to copy one around. A validated deploy job id is valid for 10 days
 * from the start of the validation (Salesforce CLI reference, `project deploy quick --job-id`), so
 * entries older than `config.deploy.quickJobMaxAgeDays` are refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EXIT, VfError } from './result.mjs';

export const STATE_DIR_RELATIVE = path.join('.vibeforce', 'state');
export const DEPLOY_JOBS_FILE = 'deploy-jobs.json';
const MAX_JOBS = 50;

function statePath(projectRoot, file) {
  return path.join(projectRoot, STATE_DIR_RELATIVE, file);
}

export function readState(projectRoot, file, fallback = {}) {
  const target = statePath(projectRoot, file);
  if (!fs.existsSync(target)) return structuredClone(fallback);
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    // A corrupt state file must not block a deploy; it is rewritten on the next successful run.
    return structuredClone(fallback);
  }
}

export function writeState(projectRoot, file, value) {
  const target = statePath(projectRoot, file);
  const dir = path.dirname(target);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${file}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    throw new VfError(`Cannot write state file ${target}: ${err.message}`, EXIT.CONFIG);
  }
  return target;
}

export function readDeployJobs(projectRoot) {
  const state = readState(projectRoot, DEPLOY_JOBS_FILE, { jobs: [] });
  return Array.isArray(state.jobs) ? state : { jobs: [] };
}

/** @param {{jobId:string,targetOrg:string,createdAt:string,testLevel:string,componentCount:number,status:string}} job */
export function recordDeployJob(projectRoot, job) {
  const state = readDeployJobs(projectRoot);
  const jobs = [job, ...state.jobs.filter((entry) => entry.jobId !== job.jobId)].slice(0, MAX_JOBS);
  writeState(projectRoot, DEPLOY_JOBS_FILE, { jobs });
  return job;
}

export function ageInDays(isoDate, now = Date.now()) {
  const created = Date.parse(isoDate);
  if (!Number.isFinite(created)) return Number.POSITIVE_INFINITY;
  return (now - created) / 86400000;
}

/**
 * Newest validated job for the org, or a reason why none is usable.
 * @returns {{job:object|null, reason:string|null, expired:object|null}}
 */
export function findValidatedJob(projectRoot, targetOrg, maxAgeDays = 10, now = Date.now()) {
  const { jobs } = readDeployJobs(projectRoot);
  const forOrg = jobs.filter((job) => job.targetOrg === targetOrg && job.status === 'Succeeded');
  if (forOrg.length === 0) {
    return {
      job: null,
      expired: null,
      reason: `no validated deployment recorded for --target-org ${targetOrg}`,
    };
  }
  const sorted = [...forOrg].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const newest = sorted[0];
  const age = ageInDays(newest.createdAt, now);
  if (age > maxAgeDays) {
    return {
      job: null,
      expired: newest,
      reason: `the newest validated job ${newest.jobId} is ${age.toFixed(1)} days old (limit ${maxAgeDays})`,
    };
  }
  return { job: newest, expired: null, reason: null };
}

export function contractPath(projectRoot) {
  return statePath(projectRoot, 'contract.md');
}
