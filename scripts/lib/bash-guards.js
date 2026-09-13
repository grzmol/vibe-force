'use strict';
/**
 * Deterministic guard rules for shell commands.
 *
 * Pure functions only: `evaluate()` takes the command string plus the resolved
 * project context and returns a decision. The PreToolUse handler does the I/O.
 * Keeping this file side-effect free is what makes tests/hooks.test.mjs able to
 * assert every rule without spawning Claude Code.
 */

const { isProductionTarget } = require('./config');
const { extractorHint } = require('./edit-guards');

const DECISION = { PASS: 'pass', ASK: 'ask', DENY: 'deny', NOTE: 'note' };

/** Split a compound shell line into individually judged segments. */
function segments(command) {
  return String(command || '')
    .split(/\s*(?:&&|\|\||;|\n|\|)\s*/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `--target-org X`, `-o X`, `--target-org=X`, or a `SF_TARGET_ORG=X` prefix. */
function targetOrg(segment) {
  const m =
    segment.match(/--target-org[=\s]+("[^"]+"|'[^']+'|[^\s]+)/) ||
    segment.match(/(?:^|\s)-o[=\s]+("[^"]+"|'[^']+'|[^\s]+)/) ||
    segment.match(/--target-dev-hub[=\s]+("[^"]+"|'[^']+'|[^\s]+)/) ||
    segment.match(/SF_TARGET_ORG=("[^"]+"|'[^']+'|[^\s]+)/);
  if (!m) return '';
  return m[1].replace(/^['"]|['"]$/g, '');
}

function jobId(segment) {
  const m = segment.match(/--job-id[=\s]+("[^"]+"|'[^']+'|[^\s]+)/);
  return m ? m[1].replace(/^['"]|['"]$/g, '') : '';
}

function isSf(segment) {
  return /(^|\s)sf(\s|$)/.test(segment) && !/(^|\s)sfdx(\s|$)/.test(segment);
}


/** Readers that dump a whole file, and the flags that bound their output. */
const DUMP_READERS = /(^|\s)(cat|less|more|nl|strings|head|tail|sed|awk)\s/;
const BOUNDED_OUTPUT = /(-n\s*'?\d+|-c\s*\d+|\s-\d+\b|--lines[=\s]\d+|--bytes[=\s]\d+)/;

/** Metadata XML paths named in a shell segment. */
function xmlPaths(segment) {
  return (String(segment || '').match(/[^\s'"|>()]+\.xml\b/g) || []).filter((p) => !p.startsWith('-'));
}

const RULES = [
  {
    id: 'xml-bulk-read',
    match: (s) => DUMP_READERS.test(s) && xmlPaths(s).length > 0,
    decide: (s, ctx) => {
      // Economy rule: the shell twin of the Read guard, because `cat` bypasses a Read matcher.
      if (ctx.mode === 'minimal' || ctx.xmlReadOverride) return { decision: DECISION.PASS };
      if (BOUNDED_OUTPUT.test(s)) return { decision: DECISION.PASS };
      if (typeof ctx.statBytes !== 'function') return { decision: DECISION.PASS };
      const max = Number((ctx.config && ctx.config.xml && ctx.config.xml.readMaxBytes) || 0) || 20000;
      for (const file of xmlPaths(s)) {
        const bytes = ctx.statBytes(file);
        if (bytes > max) return { decision: DECISION.DENY, reason: extractorHint(file, bytes) };
      }
      return { decision: DECISION.PASS };
    }
  },
  {
    id: 'retired-sfdx-syntax',
    match: (s) => /(^|\s)sfdx\s+force:/.test(s),
    decide: () => ({
      decision: DECISION.DENY,
      reason:
        'Retired CLI syntax. `sfdx force:*` commands are removed from Salesforce CLI v2. Use the `sf` equivalent, e.g. `sf project deploy start`, `sf apex run test`, `sf data query`. See skill sf-cli-operations for the full migration table.'
    })
  },
  {
    id: 'git-no-verify',
    match: (s) => /(^|\s)git\s+(commit|push|merge)\b/.test(s) && /(--no-verify|(^|\s)-n(\s|$))/.test(s),
    decide: () => ({
      decision: DECISION.DENY,
      reason: 'Bypassing git hooks is not allowed. Fix the failing check instead, or run `node "$CLAUDE_PLUGIN_ROOT/scripts/checks/vf-check.mjs" local --changed` to see what the hook would reject.'
    })
  },
  {
    id: 'git-force-push-protected',
    match: (s) => /(^|\s)git\s+push\b/.test(s) && /(--force(?!-with-lease)|(^|\s)-f(\s|$))/.test(s),
    decide: (s) => ({
      decision: /\b(main|master|develop|release\/)/.test(s) ? DECISION.DENY : DECISION.ASK,
      reason:
        'Force push detected. Protected branches must never be force-pushed; for feature branches use `--force-with-lease` so a concurrent push is not silently discarded.'
    })
  },
  {
    id: 'prod-deploy-start',
    match: (s) => isSf(s) && /\bproject\s+deploy\s+start\b/.test(s),
    decide: (s, ctx) => {
      if (!isProductionTarget(ctx.config, targetOrg(s) || ctx.defaultOrg)) return { decision: DECISION.PASS };
      if (!ctx.config.hooks.blockProductionDeploy) {
        return { decision: DECISION.ASK, reason: 'Production deploy with VF_ALLOW_PROD=1. Confirm the validated job id and the test level before proceeding.' };
      }
      return {
        decision: DECISION.DENY,
        reason:
          'Direct deploy to a production alias is blocked. Production goes through validate + quick deploy: `sf project deploy validate --target-org <prod> --test-level RunLocalTests`, then `sf project deploy quick --job-id <id> --target-org <prod>`. Set VF_ALLOW_PROD=1 only with explicit human approval. See skill sf-deployment-strategies.'
      };
    }
  },
  {
    id: 'prod-quick-deploy-unvalidated',
    match: (s) => isSf(s) && /\bproject\s+deploy\s+quick\b/.test(s),
    decide: (s, ctx) => {
      const org = targetOrg(s) || ctx.defaultOrg;
      if (!isProductionTarget(ctx.config, org)) return { decision: DECISION.PASS };
      const id = jobId(s);
      const known = (ctx.validatedJobs || []).some((j) => j.jobId === id);
      if (!id) return { decision: DECISION.DENY, reason: 'Quick deploy needs --job-id from a successful `sf project deploy validate` run.' };
      if (!known) {
        return {
          decision: DECISION.ASK,
          reason: `Job id ${id} is not in .vibeforce/state/deploy-jobs.json. Confirm it came from a successful validation against ${org || 'this org'} within the validated-deployment window before deploying.`
        };
      }
      return { decision: DECISION.ASK, reason: `Quick deploy of validated job ${id} to production alias ${org}. Confirm the release window.` };
    }
  },
  {
    id: 'ignore-flags-on-prod',
    match: (s) => isSf(s) && /\bproject\s+(deploy|retrieve)\b/.test(s) && /--ignore-(conflicts|errors|warnings)/.test(s),
    decide: (s, ctx) => {
      const prod = isProductionTarget(ctx.config, targetOrg(s) || ctx.defaultOrg);
      const flag = (s.match(/--ignore-(conflicts|errors|warnings)/) || [])[0];
      if (prod) {
        return { decision: DECISION.DENY, reason: `${flag} against a production alias is blocked: it discards drift detection or lets a partial deploy through. Resolve the conflict or the error instead.` };
      }
      return { decision: DECISION.ASK, reason: `${flag} hides real state. Confirm you inspected the conflict/error set first (\`sf project deploy start --dry-run\`).` };
    }
  },
  {
    id: 'destructive-source-delete',
    match: (s) => isSf(s) && /\bproject\s+delete\s+(source|tracking)\b/.test(s),
    decide: (s, ctx) => {
      const org = targetOrg(s) || ctx.defaultOrg;
      if (isProductionTarget(ctx.config, org)) {
        return { decision: DECISION.DENY, reason: 'Deleting metadata from a production alias is blocked. Ship a destructive change set through validate + quick deploy with `--pre-destructive-changes`/`--post-destructive-changes` and an approved plan.' };
      }
      if (!ctx.config.hooks.blockDestructive) return { decision: DECISION.PASS };
      return { decision: DECISION.ASK, reason: `\`sf project delete\` removes metadata from ${org || 'the default org'} and from the local project. Confirm the component list.` };
    }
  },
  {
    id: 'sandbox-org-delete',
    match: (s) => isSf(s) && /\borg\s+delete\s+(sandbox|scratch)\b/.test(s),
    decide: (s, ctx) => {
      if (/\borg\s+delete\s+scratch\b/.test(s)) return { decision: DECISION.PASS };
      return {
        decision: isProductionTarget(ctx.config, targetOrg(s) || ctx.defaultOrg) ? DECISION.DENY : DECISION.ASK,
        reason: 'Deleting a sandbox destroys an environment other people may be using and its refresh interval. Confirm with the org owner.'
      };
    }
  },
  {
    id: 'prod-data-mutation',
    match: (s) => isSf(s) && /\bdata\s+(delete|update|upsert|import)\b/.test(s),
    decide: (s, ctx) => {
      const org = targetOrg(s) || ctx.defaultOrg;
      if (!isProductionTarget(ctx.config, org)) {
        return /\bdata\s+delete\s+bulk\b/.test(s)
          ? { decision: DECISION.ASK, reason: 'Bulk delete is irreversible for the targeted rows. Confirm the record set (run the same filter through `sf data query` first).' }
          : { decision: DECISION.PASS };
      }
      return {
        decision: DECISION.DENY,
        reason: `Data mutation against production alias ${org} is blocked from an agent session. Use a sandbox, or have a human run the operation with an audited plan. Read-only \`sf data query\` remains available.`
      };
    }
  },
  {
    id: 'prod-anonymous-apex',
    match: (s) => isSf(s) && /\bapex\s+run\b/.test(s) && !/\bapex\s+run\s+test\b/.test(s),
    decide: (s, ctx) => {
      const org = targetOrg(s) || ctx.defaultOrg;
      if (!isProductionTarget(ctx.config, org)) return { decision: DECISION.PASS };
      return { decision: DECISION.ASK, reason: `Anonymous Apex runs with full DML rights in production alias ${org}. Confirm the script is read-only, or run it in a sandbox first.` };
    }
  },
  {
    id: 'prod-destructive-apex-test-run',
    match: (s) => isSf(s) && /\bapex\s+run\s+test\b/.test(s) && /--test-level\s+RunAllTestsInOrg/.test(s),
    decide: (s, ctx) => {
      if (!isProductionTarget(ctx.config, targetOrg(s) || ctx.defaultOrg)) return { decision: DECISION.PASS };
      return { decision: DECISION.ASK, reason: 'RunAllTestsInOrg in production consumes significant capacity and can take hours. RunLocalTests is normally the correct level.' };
    }
  },
  {
    id: 'credential-leak',
    match: (s) => /(--password|--client-secret|--jwt-key-file\s+\S+\.pem|sfdxurl|force:auth:sfdxurl)/i.test(s) || /-{1,2}p\s+["']?[A-Za-z0-9!@#$%^&*]{8,}/.test(s),
    decide: () => ({
      decision: DECISION.ASK,
      reason: 'This command carries a credential on the command line, where it lands in shell history and logs. Prefer `sf org login web`, `sf org login jwt` with a key outside the repo, or an auth file passed by path.'
    })
  },
  {
    id: 'auth-file-into-repo',
    match: (s) => /sfdx-url|authFile|\.sfdx-url\.txt/.test(s) && />|tee|cp|mv/.test(s),
    decide: () => ({ decision: DECISION.DENY, reason: 'Never write an auth URL file into the repository. Keep it outside the working tree (e.g. `$TMPDIR`) and delete it after use.' })
  },
  {
    id: 'deploy-without-local-gate',
    match: (s) => isSf(s) && /\bproject\s+deploy\s+(start|validate)\b/.test(s) && !/--dry-run/.test(s),
    decide: (s, ctx) => {
      if (ctx.gate && ctx.gate.local === 'pass') return { decision: DECISION.PASS };
      if (ctx.mode === 'strict') {
        return {
          decision: DECISION.DENY,
          reason: 'Local gate has not passed in this session. Run `node "$CLAUDE_PLUGIN_ROOT/scripts/checks/vf-check.mjs" local --changed` first; deploying unchecked metadata wastes an org round trip.'
        };
      }
      return { decision: DECISION.NOTE, reason: 'Local gate result unknown for this session. `vf-check local --changed` before deploying catches static and Jest failures without an org round trip.' };
    }
  }
];

/**
 * @param {string} command raw shell command from the tool call
 * @param {{config:object, mode:string, defaultOrg?:string, validatedJobs?:Array, gate?:object}} ctx
 * @returns {{decision:string, reason?:string, rule?:string, segment?:string}}
 */
function evaluate(command, ctx) {
  const context = Object.assign({ mode: 'standard', config: { hooks: {} }, validatedJobs: [], gate: {} }, ctx);
  const notes = [];
  for (const segment of segments(command)) {
    for (const rule of RULES) {
      if (!rule.match(segment)) continue;
      const result = rule.decide(segment, context) || { decision: DECISION.PASS };
      if (result.decision === DECISION.DENY || result.decision === DECISION.ASK) {
        return { decision: result.decision, reason: result.reason, rule: rule.id, segment };
      }
      if (result.decision === DECISION.NOTE) notes.push({ rule: rule.id, reason: result.reason, segment });
    }
  }
  if (notes.length) return { decision: DECISION.NOTE, reason: notes.map((n) => n.reason).join(' '), rule: notes.map((n) => n.rule).join(','), segment: notes[0].segment };
  return { decision: DECISION.PASS };
}

module.exports = { DECISION, RULES, evaluate, segments, targetOrg, jobId, xmlPaths };
