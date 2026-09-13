import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { evaluate, DECISION, targetOrg } = require('../scripts/lib/bash-guards.js');
const { evaluateEdit, evaluateRead } = require('../scripts/lib/edit-guards.js');
const { lintXml, apiVersionOf } = require('../scripts/lib/xml-lint.js');
const { classify, expectedApexTest, expectedLwcTest } = require('../scripts/lib/sf-paths.js');
const { evaluate: evaluateMcp } = require('../scripts/lib/mcp-guards.js');
const { isProductionTarget, mergeDeep, FALLBACK } = require('../scripts/lib/config.js');

const config = mergeDeep(FALLBACK, { productionAliases: ['acme-prod', 'prod'] });
const ctx = { config, mode: 'standard', validatedJobs: [], gate: {} };

/* ---------- bash guards ---------- */

test('blocks a direct production deploy and names the validate+quick path', () => {
  const v = evaluate('sf project deploy start --source-dir force-app --target-org acme-prod', ctx);
  assert.equal(v.decision, DECISION.DENY);
  assert.equal(v.rule, 'prod-deploy-start');
  assert.match(v.reason, /deploy validate/);
});

test('does not block the same deploy against a sandbox alias', () => {
  const v = evaluate('sf project deploy start --source-dir force-app --target-org acme-uat', ctx);
  assert.equal(v.decision, DECISION.NOTE, 'only the local-gate reminder applies to a sandbox');
  const gated = evaluate('sf project deploy start --source-dir force-app --target-org acme-uat', { ...ctx, gate: { local: 'pass' } });
  assert.equal(gated.decision, DECISION.PASS);
});

test('production deploy is only downgraded to a prompt when VF_ALLOW_PROD flipped the config', () => {
  const relaxed = { ...ctx, config: mergeDeep(config, { hooks: { blockProductionDeploy: false } }) };
  const v = evaluate('sf project deploy start -o acme-prod', relaxed);
  assert.equal(v.decision, DECISION.ASK);
});

test('quick deploy to production requires a job id known to the state file', () => {
  const unknown = evaluate('sf project deploy quick --job-id 0Af000000000001 --target-org acme-prod', ctx);
  assert.equal(unknown.decision, DECISION.ASK);
  assert.match(unknown.reason, /deploy-jobs\.json/);

  const missing = evaluate('sf project deploy quick --target-org acme-prod', ctx);
  assert.equal(missing.decision, DECISION.DENY);

  const known = evaluate('sf project deploy quick --job-id 0Af000000000001 --target-org acme-prod', {
    ...ctx,
    validatedJobs: [{ jobId: '0Af000000000001', targetOrg: 'acme-prod', status: 'Succeeded' }]
  });
  assert.equal(known.decision, DECISION.ASK);
  assert.match(known.reason, /validated job/);
});

test('blocks destructive data commands against production but leaves queries alone', () => {
  assert.equal(evaluate('sf data delete bulk --sobject Account --file ids.csv -o acme-prod', ctx).decision, DECISION.DENY);
  assert.equal(evaluate('sf data query -q "SELECT Id FROM Account" -o acme-prod', ctx).decision, DECISION.PASS);
});

test('blocks metadata deletion on production and prompts elsewhere', () => {
  assert.equal(evaluate('sf project delete source --metadata ApexClass:Foo --target-org acme-prod', ctx).decision, DECISION.DENY);
  assert.equal(evaluate('sf project delete source --metadata ApexClass:Foo --target-org acme-dev', ctx).decision, DECISION.ASK);
});

test('blocks retired sfdx force syntax with the sf replacement', () => {
  const v = evaluate('sfdx force:source:deploy -p force-app', ctx);
  assert.equal(v.decision, DECISION.DENY);
  assert.match(v.reason, /sf project deploy start/);
});

test('blocks git hook bypasses and protected-branch force pushes', () => {
  assert.equal(evaluate('git commit --no-verify -m "wip"', ctx).decision, DECISION.DENY);
  assert.equal(evaluate('git push --force origin main', ctx).decision, DECISION.DENY);
  assert.equal(evaluate('git push --force-with-lease origin feature/x', ctx).decision, DECISION.PASS);
});

test('blocks --ignore-conflicts against production and prompts for sandboxes', () => {
  assert.equal(evaluate('sf project deploy start --ignore-conflicts -o acme-prod', ctx).decision, DECISION.DENY);
  assert.equal(evaluate('sf project deploy start --ignore-conflicts -o acme-dev', ctx).decision, DECISION.ASK);
});

test('prompts before anonymous Apex in production but not in a scratch org', () => {
  assert.equal(evaluate('sf apex run --file scripts/apex/fix.apex -o acme-prod', ctx).decision, DECISION.ASK);
  assert.equal(evaluate('sf apex run --file scripts/apex/fix.apex -o vf-scratch', ctx).decision, DECISION.PASS);
});

test('judges every segment of a compound command', () => {
  const v = evaluate('npm ci && sf project deploy start -o acme-prod', ctx);
  assert.equal(v.decision, DECISION.DENY);
  assert.equal(v.segment, 'sf project deploy start -o acme-prod');
});

test('missing local gate notes in standard mode and denies in strict mode', () => {
  const note = evaluate('sf project deploy validate -o acme-uat', ctx);
  assert.equal(note.decision, DECISION.NOTE);
  const strict = evaluate('sf project deploy validate -o acme-uat', { ...ctx, mode: 'strict' });
  assert.equal(strict.decision, DECISION.DENY);
  const passed = evaluate('sf project deploy validate -o acme-uat', { ...ctx, mode: 'strict', gate: { local: 'pass' } });
  assert.equal(passed.decision, DECISION.PASS);
});

test('target org is read from every supported flag form', () => {
  assert.equal(targetOrg('sf apex run test --target-org acme-prod'), 'acme-prod');
  assert.equal(targetOrg('sf apex run test -o "acme prod"'), 'acme prod');
  assert.equal(targetOrg('sf apex run test --target-org=acme-prod'), 'acme-prod');
  assert.equal(targetOrg('sf apex run test'), '');
});

test('production alias matching is case-insensitive and substring-aware', () => {
  assert.equal(isProductionTarget(config, 'ACME-PROD'), true);
  assert.equal(isProductionTarget(config, 'release@acme-prod.com'), true);
  assert.equal(isProductionTarget(config, 'acme-uat'), false);
  assert.equal(isProductionTarget(config, ''), false);
});

/* ---------- edit guards ---------- */

const editBase = { config, mode: 'standard', agentType: '', conflict: null, anyExists: () => true };

test('refuses to write generated CLI state', () => {
  const v = evaluateEdit({ ...editBase, filePath: '.sfdx/tools/apex.db', content: 'x' });
  assert.equal(v.decision, 'deny');
  assert.equal(v.rule, 'generated-path');
});

test('refuses secrets in source and prompts on password literals', () => {
  const key = evaluateEdit({ ...editBase, filePath: 'force-app/main/default/classes/A.cls', content: '-----BEGIN RSA PRIVATE KEY-----\nabc' });
  assert.equal(key.decision, 'deny');
  assert.match(key.reason, /External Credential/);

  const pwd = evaluateEdit({ ...editBase, filePath: 'force-app/main/default/classes/A.cls', content: "String password = 'Sup3rSecret!';" });
  assert.equal(pwd.decision, 'ask');
});

test('blocks a second agent from editing a claimed file', () => {
  const v = evaluateEdit({
    ...editBase,
    filePath: 'force-app/main/default/classes/AccountsService.cls',
    content: 'public class AccountsService {}',
    conflict: { agentId: 'a1', agentType: 'sf-apex-engineer', at: new Date().toISOString() }
  });
  assert.equal(v.decision, 'deny');
  assert.equal(v.rule, 'ownership-conflict');
});

test('enforces wave-1 slice boundaries between build agents', () => {
  const v = evaluateEdit({ ...editBase, agentType: 'sf-lwc-engineer', filePath: 'force-app/main/default/classes/AccountsService.cls', content: 'public class AccountsService {}' });
  assert.equal(v.decision, 'deny');
  assert.equal(v.rule, 'slice-boundary');
  assert.match(v.reason, /sf-apex-engineer/);

  const own = evaluateEdit({ ...editBase, agentType: 'sf-lwc-engineer', filePath: 'force-app/main/default/lwc/accountList/accountList.js', content: 'export default class {}' });
  assert.equal(own.decision, 'pass');
});

test('main session and reviewers are not slice-restricted', () => {
  const v = evaluateEdit({ ...editBase, agentType: 'sf-quality-gate', filePath: 'force-app/main/default/classes/AccountsService.cls', content: 'public class AccountsService {}' });
  assert.equal(v.decision, 'pass');
});

test('prompts on profile edits because policy is permission-set-first', () => {
  const v = evaluateEdit({ ...editBase, filePath: 'force-app/main/default/profiles/Admin.profile-meta.xml', content: '<Profile/>' });
  assert.equal(v.decision, 'ask');
  assert.equal(v.rule, 'profile-edit');
});

test('reports bulkification and test-pairing problems as notes, not blocks', () => {
  const v = evaluateEdit({
    ...editBase,
    filePath: 'force-app/main/default/classes/AccountsService.cls',
    content: 'public class AccountsService { void run(List<Id> ids) { for (Id i : ids) { Account a = [SELECT Id FROM Account WHERE Id = :i]; update a; } } }',
    anyExists: () => false
  });
  assert.equal(v.decision, 'pass');
  const joined = v.notes.join('\n');
  assert.match(joined, /SOQL inside a loop/);
  assert.match(joined, /DML inside a loop/);
  assert.match(joined, /No test class found/);
});

test('flags a missing Jest test for a new LWC module', () => {
  const v = evaluateEdit({ ...editBase, filePath: 'force-app/main/default/lwc/accountList/accountList.js', content: 'export default class {}', anyExists: () => false });
  assert.match(v.notes.join('\n'), /__tests__\/accountList\.test\.js/);
});

/* ---------- classification ---------- */

test('classifies Salesforce source into wave-1 slices', () => {
  assert.equal(classify('force-app/main/default/classes/A.cls').owner, 'sf-apex-engineer');
  assert.equal(classify('force-app/main/default/classes/integration/PaymentGateway.cls').owner, 'sf-integration-engineer');
  assert.equal(classify('force-app/main/default/lwc/x/x.html').owner, 'sf-lwc-engineer');
  assert.equal(classify('force-app/main/default/permissionsets/X.permissionset-meta.xml').owner, 'sf-metadata-engineer');
  assert.equal(classify('force-app/main/default/namedCredentials/X.namedCredential-meta.xml').owner, 'sf-integration-engineer');
  assert.equal(classify('force-app/main/default/classes/ATest.cls').isTest, true);
  assert.equal(classify('node_modules/foo/index.js').generated, true);
});

test('the contract and the architecture record are authored, the rest of the state is not', () => {
  // The orchestrator has to be able to write the file the whole wave model reads.
  assert.equal(classify('.vibeforce/state/contract.md').generated, false);
  assert.equal(classify('.vibeforce/state/architecture.md').generated, false);
  assert.equal(classify('.vibeforce/state/ownership.json').generated, true);
  assert.equal(classify('.vibeforce/state/touched.json').generated, true);
  assert.equal(classify('.vibeforce/reports/local-2026.json').generated, true);
});

test('integration metadata directories match the official metadata registry', () => {
  // ExternalServiceRegistration lives in externalServiceRegistrations/, not externalServices/;
  // ExternalClientApplication in externalClientApps/. A wrong directory name matches nothing, so
  // the path has no owner and the collision guard has nothing to enforce.
  assert.equal(
    classify('force-app/main/default/externalServiceRegistrations/Billing.externalServiceRegistration-meta.xml').owner,
    'sf-integration-engineer'
  );
  assert.equal(classify('force-app/main/default/externalClientApps/Portal.eca-meta.xml').owner, 'sf-integration-engineer');
  assert.equal(classify('force-app/main/default/dataSources/Ledger.dataSource-meta.xml').owner, 'sf-integration-engineer');
});

/* ---------- mcp guard ---------- */

test('an MCP deploy to production is denied, and to a scratch org is not', () => {
  const deny = evaluateMcp('mcp__salesforce-dx__deploy_metadata', { usernameOrAlias: 'acme-prod' }, { config });
  assert.equal(deny.decision, 'deny');
  assert.equal(deny.rule, 'mcp-prod-deploy');
  assert.match(deny.reason, /deploy-validate/);

  const dev = evaluateMcp('mcp__salesforce-dx__deploy_metadata', { usernameOrAlias: 'acme-dev' }, { config, gate: { status: 'pass' } });
  assert.equal(dev.decision, 'pass');
});

test('an MCP deploy without a passing local gate is noted, not blocked', () => {
  const v = evaluateMcp('mcp__salesforce-dx__deploy_metadata', { usernameOrAlias: 'acme-dev' }, { config });
  assert.equal(v.decision, 'note');
  assert.match(v.reason, /local gate/);
});

test('the production alias is found wherever it sits in the arguments', () => {
  const nested = evaluateMcp('mcp__salesforce-dx__delete_org', { target: { org: { alias: 'prod' } } }, { config });
  assert.equal(nested.decision, 'deny');
  assert.equal(nested.rule, 'mcp-prod-org-delete');

  const perms = evaluateMcp('mcp__salesforce-dx__assign_permission_set', { permissionSetName: 'X', usernameOrAlias: 'acme-prod' }, { config });
  assert.equal(perms.decision, 'ask');
});

test('read-only MCP tools and non-MCP tools pass untouched', () => {
  assert.equal(evaluateMcp('mcp__salesforce-dx__run_soql_query', { usernameOrAlias: 'acme-prod' }, { config }).decision, 'pass');
  assert.equal(evaluateMcp('mcp__salesforce-dx__list_all_orgs', {}, { config }).decision, 'pass');
  assert.equal(evaluateMcp('Bash', { command: 'sf project deploy start -o acme-prod' }, { config }).decision, 'pass');
});

test('retrieving metadata over MCP warns that it bypasses path ownership', () => {
  const v = evaluateMcp('mcp__salesforce-dx__retrieve_metadata', { usernameOrAlias: 'acme-dev' }, { config });
  assert.equal(v.decision, 'note');
  assert.match(v.reason, /edit guard/);
});

test('Agentforce and Data Cloud metadata has an owner', () => {
  assert.equal(classify('force-app/main/default/bots/Support.bot-meta.xml').owner, 'sf-metadata-engineer');
  assert.equal(classify('force-app/main/default/aiAuthoringBundles/Support/Support.agent').owner, 'sf-metadata-engineer');
  assert.equal(classify('force-app/main/default/genAiFunctions/Refund/Refund.genAiFunction-meta.xml').owner, 'sf-metadata-engineer');
  assert.equal(classify('force-app/main/default/dataStreamDefinitions/Orders.dataStreamDefinition-meta.xml').owner, 'sf-metadata-engineer');
  // the Apex behind an agent action is still the Apex engineer's file
  assert.equal(classify('force-app/main/default/classes/RefundAction.cls').owner, 'sf-apex-engineer');
});

test('derives expected test paths', () => {
  assert.deepEqual(expectedApexTest('force-app/main/default/classes/A.cls')[0], 'force-app/main/default/classes/ATest.cls');
  assert.deepEqual(expectedLwcTest('force-app/main/default/lwc/foo/foo.js'), ['force-app/main/default/lwc/foo/__tests__/foo.test.js']);
});

/* ---------- xml lint ---------- */

test('accepts well-formed metadata and rejects the usual hand-edit damage', () => {
  const good = '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>67.0</apiVersion><status>Active</status></ApexClass>';
  assert.equal(lintXml(good).ok, true);
  assert.equal(apiVersionOf(good), '67.0');

  assert.match(lintXml('<?xml version="1.0"?><A><B></A>').errors.join(' '), /does not match/);
  assert.match(lintXml('<?xml version="1.0"?><A><B/>').errors.join(' '), /unclosed/);
  assert.match(lintXml('<A/>').errors.join(' '), /declaration/);
  assert.match(lintXml('<?xml version="1.0"?><A>Tom & Jerry</A>').errors.join(' '), /unescaped/);
});

/* ---------- handler process contract ---------- */

function runHook(script, payload, env = {}) {
  const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'hooks', script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

test('pre-bash-guard emits a deny decision on stdout for a production deploy', () => {
  const project = mkdtempSync(path.join(tmpdir(), 'vf-proj-'));
  try {
    writeFileSync(path.join(project, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '67.0' }));
    mkdirSync(path.join(project, '.vibeforce'), { recursive: true });
    writeFileSync(path.join(project, '.vibeforce', 'config.json'), JSON.stringify({ productionAliases: ['acme-prod'] }));

    const out = runHook('pre-bash-guard.js', {
      hook_event_name: 'PreToolUse',
      session_id: 'test-session',
      cwd: project,
      project_dir: project,
      tool_name: 'Bash',
      tool_input: { command: 'sf project deploy start -o acme-prod' }
    });

    assert.equal(out.status, 0);
    const decision = JSON.parse(out.stdout);
    assert.equal(decision.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(decision.hookSpecificOutput.permissionDecisionReason, /prod-deploy-start/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('pre-bash-guard stays silent for a harmless command and for hooks.mode=off', () => {
  const quiet = runHook('pre-bash-guard.js', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm ci' } });
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, '');

  const disabled = runHook(
    'pre-bash-guard.js',
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'sfdx force:source:deploy -p force-app' } },
    { VF_HOOK_MODE: 'off' }
  );
  assert.equal(disabled.stdout, '');
});

test('post-edit-check claims the file, lints XML and survives a missing project', () => {
  const project = mkdtempSync(path.join(tmpdir(), 'vf-proj-'));
  try {
    writeFileSync(path.join(project, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '67.0' }));
    const dir = path.join(project, 'force-app', 'main', 'default', 'objects', 'Account', 'fields');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'Rating__c.field-meta.xml');
    writeFileSync(file, '<?xml version="1.0" encoding="UTF-8"?>\n<CustomField><fullName>Rating__c</fullName>');

    const out = runHook('post-edit-check.js', {
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      cwd: project,
      project_dir: project,
      tool_name: 'Write',
      agent_id: 'agent-1',
      agent_type: 'sf-metadata-engineer',
      tool_input: { file_path: file }
    });

    assert.equal(out.status, 0);
    const parsed = JSON.parse(out.stdout);
    assert.match(parsed.hookSpecificOutput.additionalContext, /unclosed tag/);

    const ownership = JSON.parse(require('node:fs').readFileSync(path.join(project, '.vibeforce', 'state', 'ownership.json'), 'utf8'));
    assert.ok(ownership.claims['force-app/main/default/objects/Account/fields/Rating__c.field-meta.xml']);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('stop-local-gate does nothing when no Salesforce file was touched', () => {
  const project = mkdtempSync(path.join(tmpdir(), 'vf-proj-'));
  try {
    writeFileSync(path.join(project, 'sfdx-project.json'), '{"packageDirectories":[{"path":"force-app","default":true}]}');
    const out = runHook('stop-local-gate.js', { hook_event_name: 'Stop', session_id: 'empty', cwd: project, project_dir: project });
    assert.equal(out.status, 0);
    assert.equal(out.stdout, '');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('subagent-stop-release drops the finishing agent claims', () => {
  const project = mkdtempSync(path.join(tmpdir(), 'vf-proj-'));
  try {
    writeFileSync(path.join(project, 'sfdx-project.json'), '{"packageDirectories":[{"path":"force-app","default":true}]}');
    const stateDir = path.join(project, '.vibeforce', 'state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      path.join(stateDir, 'ownership.json'),
      JSON.stringify({
        claims: { 'force-app/main/default/classes/A.cls': { agentId: 'a1', agentType: 'sf-apex-engineer', at: new Date().toISOString() } },
        agents: { a1: { agentType: 'sf-apex-engineer', files: ['force-app/main/default/classes/A.cls'], at: new Date().toISOString() } }
      })
    );

    runHook('subagent-stop-release.js', { hook_event_name: 'SubagentStop', session_id: 's1', cwd: project, project_dir: project, agent_id: 'a1', agent_type: 'sf-apex-engineer' });
    const after = JSON.parse(require('node:fs').readFileSync(path.join(stateDir, 'ownership.json'), 'utf8'));
    assert.deepEqual(after.claims, {});
    assert.equal(after.agents.a1, undefined);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

// --- xml-bulk-read: keep large metadata out of the context window ---------

const xmlConfig = { xml: { readMaxBytes: 20000 }, hooks: {}, gates: {} };
const PROFILE = 'force-app/main/default/profiles/Admin.profile-meta.xml';

test('evaluateRead denies a whole-file read of large metadata XML', () => {
  const v = evaluateRead({ filePath: PROFILE, bytes: 180000, config: xmlConfig, mode: 'standard' });
  assert.equal(v.decision, DECISION.DENY);
  assert.equal(v.rule, 'xml-bulk-read');
  // the message has to carry the command that replaces the read
  assert.match(v.reason, /vf-xml\.js" outline/);
  assert.match(v.reason, /vf-xml\.js" get/);
  assert.match(v.reason, /VF_XML_READ=1/);
});

test('evaluateRead leaves small files, non-metadata and bounded reads alone', () => {
  assert.equal(evaluateRead({ filePath: PROFILE, bytes: 4000, config: xmlConfig, mode: 'standard' }).decision, DECISION.PASS);
  assert.equal(evaluateRead({ filePath: 'force-app/main/default/classes/AccountService.cls', bytes: 180000, config: xmlConfig, mode: 'standard' }).decision, DECISION.PASS);
  assert.equal(evaluateRead({ filePath: PROFILE, bytes: 180000, config: xmlConfig, mode: 'standard', override: true }).decision, DECISION.PASS);
  assert.equal(evaluateRead({ filePath: PROFILE, bytes: 180000, config: xmlConfig, mode: 'minimal' }).decision, DECISION.PASS);
});

test('the shell twin blocks an unbounded dump of the same file', () => {
  const ctx = { config: xmlConfig, mode: 'standard', statBytes: (f) => (f.includes('Admin') ? 180000 : 400) };
  const denied = evaluate(`cat ${PROFILE}`, ctx);
  assert.equal(denied.decision, DECISION.DENY);
  assert.equal(denied.rule, 'xml-bulk-read');
  assert.equal(evaluate(`less ${PROFILE}`, ctx).decision, DECISION.DENY);
  assert.equal(evaluate(`cat small.xml`, ctx).decision, DECISION.PASS);
});

test('the shell twin allows reads that already bound their output', () => {
  const ctx = { config: xmlConfig, mode: 'standard', statBytes: () => 180000 };
  for (const cmd of [`head -50 ${PROFILE}`, `head -n 50 ${PROFILE}`, `head -c 800 ${PROFILE}`, `sed -n 1,40p ${PROFILE}`, `tail -20 ${PROFILE}`, `grep fieldPermissions ${PROFILE}`]) {
    assert.equal(evaluate(cmd, ctx).decision, DECISION.PASS, cmd);
  }
});

test('the shell twin cannot decide without a size probe, and fails open', () => {
  assert.equal(evaluate(`cat ${PROFILE}`, { config: xmlConfig, mode: 'standard' }).decision, DECISION.PASS);
  assert.equal(evaluate(`cat ${PROFILE}`, { config: xmlConfig, mode: 'minimal', statBytes: () => 180000 }).decision, DECISION.PASS);
});
