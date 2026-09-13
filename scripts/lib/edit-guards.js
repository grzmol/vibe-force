'use strict';
/**
 * Deterministic guard rules for Write/Edit tool calls.
 *
 * Pure functions: `evaluateEdit()` receives the target path, the incoming
 * content and the resolved context, and returns a decision plus advisory notes.
 * All filesystem and state access happens in the handler.
 */

const { classify, expectedApexTest, expectedLwcTest, SLICES } = require('./sf-paths');

const DECISION = { PASS: 'pass', ASK: 'ask', DENY: 'deny', NOTE: 'note' };

const SECRET_PATTERNS = [
  { id: 'private-key', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, severity: 'deny', hint: 'private key material' },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/, severity: 'deny', hint: 'AWS access key id' },
  { id: 'sfdx-auth-url', re: /force:\/\/[^\s"'<]+/, severity: 'deny', hint: 'Salesforce auth URL (force://...)' },
  { id: 'slack-token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/, severity: 'deny', hint: 'Slack token' },
  { id: 'github-token', re: /\bgh[pousr]_[0-9A-Za-z]{30,}/, severity: 'deny', hint: 'GitHub token' },
  { id: 'bearer-literal', re: /['"]Bearer\s+[A-Za-z0-9._-]{20,}['"]/, severity: 'deny', hint: 'hardcoded bearer token' },
  { id: 'client-secret', re: /(client_?secret|consumer_?secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/i, severity: 'deny', hint: 'OAuth client secret' },
  { id: 'password-literal', re: /(password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{6,}['"]/i, severity: 'ask', hint: 'password literal' },
  { id: 'metadata-password', re: /<password>[^<]{4,}<\/password>/i, severity: 'ask', hint: '<password> value in metadata' }
];

const QUALITY_PATTERNS = [
  { id: 'see-all-data', re: /@isTest\s*\(\s*SeeAllData\s*=\s*true\s*\)/i, note: 'SeeAllData=true couples the test to org data. Build the records in @TestSetup or a factory instead (skill sf-apex-testing).' },
  { id: 'hardcoded-id', re: /['"](?:[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})['"]/, note: 'Possible hardcoded record/metadata id. Resolve ids at runtime (Schema describe, custom metadata, Label) so the code survives a deploy to another org.' },
  { id: 'soql-in-loop', re: /for\s*\([^)]*\)\s*\{[^}]{0,400}\[\s*SELECT/is, note: 'SOQL inside a loop. Query once and map by key (skill sf-governor-limits).' },
  { id: 'dml-in-loop', re: /for\s*\([^)]*\)\s*\{[^}]{0,400}\b(insert|update|delete|upsert)\s+[a-zA-Z_]/is, note: 'DML inside a loop. Collect records and perform one DML statement, or register them with the unit of work (skill sf-fflib-domain-service-uow).' },
  { id: 'without-sharing', re: /\bwithout\s+sharing\b/i, note: '`without sharing` bypasses record-level access. Justify it in a comment and confirm FLS is still enforced (skill sf-security-model).' },
  { id: 'legacy-assert', re: /\bSystem\.assert(Equals|NotEquals)?\s*\(/, note: 'Prefer the Assert class (`Assert.areEqual`, `Assert.isTrue`) over the legacy System.assert* methods.' },
  { id: 'string-query-concat', re: /Database\.query\s*\(\s*['"][^'"]*['"]\s*\+/, note: 'Dynamic SOQL built by concatenation. Use bind variables (`Database.queryWithBinds`) to stay injection-safe (skill sf-soql-sosl-optimization).' },
  { id: 'console-log', re: /^\s*console\.log\(/m, note: 'console.log left in LWC source. Remove it or route it through a debug flag before the gate runs.' }
];

function secretFindings(content) {
  if (!content) return [];
  return SECRET_PATTERNS.filter((p) => p.re.test(content)).map((p) => ({ id: p.id, severity: p.severity, hint: p.hint }));
}

function qualityNotes(content, info) {
  if (!content) return [];
  const applicable = QUALITY_PATTERNS.filter((p) => {
    if (p.id === 'console-log') return info.isLwc;
    return info.isApex;
  });
  return applicable.filter((p) => p.re.test(content)).map((p) => ({ id: p.id, note: p.note }));
}


/** Bytes per token for metadata XML, matching xml-nodes.estimateTokens. */
const BYTES_PER_TOKEN = 3.5;

/**
 * How to get the same information for a fraction of the tokens.
 * Kept here so the shell rule and the Read branch quote one text.
 */
function extractorHint(target, bytes) {
  const tool = 'node "$CLAUDE_PLUGIN_ROOT/scripts/vf-xml.js"';
  return (
    `${target} is ${Math.round(bytes / 1024)} kB (about ${Math.round(bytes / BYTES_PER_TOKEN)} tokens). ` +
    `Reading it whole spends the session's context on metadata nobody asked for. Get the structure, then the one node you need:\n` +
    `  ${tool} outline ${target}\n` +
    `  ${tool} get ${target} '//fieldPermissions[field=Account.Rating]'\n` +
    `Patch with set / replace / insert / remove on the same selectors: the file stays byte-identical outside the range addressed, so the diff stays reviewable. ` +
    `If the whole file really is the task, set VF_XML_READ=1 for that call or raise xml.readMaxBytes.`
  );
}

/**
 * PreToolUse / Read: keep large metadata XML out of the context window.
 *
 * Economy rule, not a safety rule, so `minimal` mode opts out and an explicit
 * VF_XML_READ=1 overrides it.
 *
 * @param {{filePath:string, bytes:number, config:object, mode:string, override?:boolean}} args
 * @returns {{decision:string, reason?:string, rule?:string, notes:string[]}}
 */
function evaluateRead(args) {
  const { filePath, bytes, config, mode, override } = args;
  const notes = [];
  if (mode === 'minimal' || override) return { decision: DECISION.PASS, notes };
  const info = classify(filePath);
  if (!info.isMetadataXml) return { decision: DECISION.PASS, notes };
  const max = Number((config && config.xml && config.xml.readMaxBytes) || 0) || 20000;
  if (!Number.isFinite(bytes) || bytes <= max) return { decision: DECISION.PASS, notes };
  return { decision: DECISION.DENY, rule: 'xml-bulk-read', notes, reason: extractorHint(info.path, bytes) };
}

/**
 * @param {object} args
 * @param {string} args.filePath repo-relative or absolute path
 * @param {string} args.content incoming file content (or replacement text)
 * @param {string} args.agentType subagent type making the edit ('' for the main session)
 * @param {{agentId:string, agentType:string}|null} args.conflict live claim from another agent
 * @param {object} args.config resolved vibe-force config
 * @param {string} args.mode hook mode
 * @param {(candidates:string[])=>boolean} args.anyExists existence probe for pairing checks
 * @returns {{decision:string, reason?:string, rule?:string, notes:string[]}}
 */
function evaluateEdit(args) {
  const { filePath, content, agentType, conflict, config, mode, anyExists } = args;
  const info = classify(filePath);
  const notes = [];

  if (info.generated) {
    return { decision: DECISION.DENY, rule: 'generated-path', notes, reason: `${info.path} is generated or runtime state. Change the source metadata or the vibe-force config instead; this file is rewritten by the CLI.` };
  }

  const secrets = secretFindings(content);
  const hardSecret = secrets.find((s) => s.severity === 'deny');
  if (hardSecret) {
    return {
      decision: DECISION.DENY,
      rule: `secret:${hardSecret.id}`,
      notes,
      reason: `Refusing to write ${hardSecret.hint} into ${info.path}. Secrets belong in an External Credential / Named Credential, a protected custom setting, or the CI secret store (skill sf-security-model, skill sf-integration-patterns).`
    };
  }
  const softSecret = secrets.find((s) => s.severity === 'ask');
  if (softSecret) {
    return { decision: DECISION.ASK, rule: `secret:${softSecret.id}`, notes, reason: `${info.path} appears to contain ${softSecret.hint}. Confirm this is test-only data and not a real credential.` };
  }

  if (conflict && config.hooks && config.hooks.enforceOwnership) {
    return {
      decision: DECISION.DENY,
      rule: 'ownership-conflict',
      notes,
      reason: `${info.path} is claimed by agent ${conflict.agentType || conflict.agentId} in this wave. Parallel edits to the same metadata file are not merge-safe: coordinate through the orchestrator, or take a different file.`
    };
  }

  if (info.slice && agentType && SLICES[info.slice] && SLICES[info.slice].agent !== agentType) {
    const isWaveOneAgent = Object.values(SLICES).some((s) => s.agent === agentType);
    if (isWaveOneAgent) {
      return {
        decision: DECISION.DENY,
        rule: 'slice-boundary',
        notes,
        reason: `${info.path} belongs to the ${info.slice} slice owned by ${SLICES[info.slice].agent}; ${agentType} may not write it. Publish the contract change instead and let the owning agent apply it.`
      };
    }
  }

  if (info.kind === 'profile' && mode !== 'minimal') {
    return {
      decision: DECISION.ASK,
      rule: 'profile-edit',
      notes,
      reason: 'Profile metadata is being edited. vibe-force policy is permission-set-first: profiles are large, merge-hostile, and deploy-fragile. Confirm no permission set can carry this change.'
    };
  }

  for (const q of qualityNotes(content, info)) notes.push(q.note);

  if (info.kind === 'apex-class' && !info.isTest && config.gates && config.gates.requireTestForApexClass && typeof anyExists === 'function') {
    if (!anyExists(expectedApexTest(info.path))) notes.push(`No test class found for ${info.path}. Add one before the gate runs (expected ${expectedApexTest(info.path)[0]}).`);
  }
  if (info.kind === 'lwc-js' && config.gates && config.gates.requireJestForLwc && typeof anyExists === 'function') {
    const expected = expectedLwcTest(info.path);
    if (expected.length && !anyExists(expected)) notes.push(`No Jest test found for this component. Add ${expected[0]} (skill sf-lwc-jest-testing).`);
  }
  if (/sfdx-project\.json$/.test(info.path)) notes.push('sfdx-project.json changed: package directories, sourceApiVersion and package aliases affect every deploy and the check runner. Re-run `vf-check local` after the change.');
  if (/\.forceignore$/.test(info.path)) notes.push('.forceignore changed: ignored metadata silently disappears from deploys. Verify with `sf project deploy start --dry-run --target-org <alias>`.');

  return { decision: DECISION.PASS, notes };
}

module.exports = { DECISION, SECRET_PATTERNS, QUALITY_PATTERNS, evaluateEdit, evaluateRead, extractorHint, secretFindings, qualityNotes };
