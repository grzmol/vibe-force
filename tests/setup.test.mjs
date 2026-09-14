import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sd = require('../scripts/lib/setup-destinations.js');
const ss = require('../scripts/lib/setup-session.js');
const { evaluate: evaluateMcp, DECISION } = require('../scripts/lib/mcp-guards.js');
const { mergeDeep, FALLBACK } = require('../scripts/lib/config.js');

const config = mergeDeep(FALLBACK, { productionAliases: ['acme-prod', 'prod'] });
const orgTypes = new Set(['Flow', 'FlowDefinition', 'ApexClass', 'CustomObject', 'CustomField']);

/* ---------- destinations ---------- */

test('a catalog key resolves to the shipped path, an unknown word does not', () => {
  const hit = sd.resolveDestination('flows', config);
  assert.equal(hit.ok, true);
  assert.equal(hit.destination.path, 'lightning/setup/Flows/home');

  const miss = sd.resolveDestination('flowz please', config);
  assert.equal(miss.ok, false, 'a word with a space is neither a key nor a legal path');
  assert.match(miss.error, /Known destinations/);
});

test('an ad-hoc path is accepted but an absolute URL or traversal is not', () => {
  assert.equal(sd.resolveDestination('lightning/setup/CompanyProfileInfo/home', config).ok, true);
  assert.equal(sd.resolveDestination('/apex/MyPage', config).ok, true);

  for (const bad of ['https://acme.my.salesforce.com/lightning', '//acme.my.salesforce.com/x', 'lightning/../../etc/passwd']) {
    const v = sd.resolveDestination(bad, config);
    assert.equal(v.ok, false, `${bad} must be refused`);
  }
});

test('project destinations override the shipped catalog and carry their own metadata claim', () => {
  const withProject = mergeDeep(config, {
    setup: { destinations: { 'einstein-activation': { path: 'lightning/setup/EinsteinSetup/home', metadata: [] } } }
  });
  const v = sd.resolveDestination('einstein-activation', withProject);
  assert.equal(v.ok, true);
  assert.equal(v.destination.path, 'lightning/setup/EinsteinSetup/home');
  assert.match(v.destination.source, /config\.json/);
});

test('describeMetadata output is flattened to xmlNames including child types', () => {
  const types = sd.describedTypes({
    status: 0,
    result: {
      metadataObjects: [
        { xmlName: 'CustomObject', childXmlNames: ['CustomField', 'RecordType'] },
        { xmlName: 'Flow', childXmlNames: [] },
        { directoryName: 'broken' }
      ]
    }
  });
  assert.deepEqual([...types].sort(), ['CustomField', 'CustomObject', 'Flow', 'RecordType']);
  assert.equal(sd.describedTypes(null).size, 0, 'a missing payload is an empty set, not a throw');
});

test('the metadata gate refuses a browser when the org deploys the owning type', () => {
  const destination = sd.resolveDestination('flows', config).destination;
  const v = sd.metadataVerdict({ destination, orgTypes });
  assert.equal(v.verdict, sd.VERDICT.DEPLOY);
  assert.deepEqual(v.types, ['Flow', 'FlowDefinition']);
  assert.match(sd.deployInsteadHint(destination, v.types), /project retrieve start --metadata Flow/);
});

test('the gate clears a destination the org cannot deploy, and never gates a read', () => {
  const orphan = { path: 'lightning/setup/EinsteinSetup/home', metadata: ['EinsteinSettings'], readOnly: false };
  assert.equal(sd.metadataVerdict({ destination: orphan, orgTypes }).verdict, sd.VERDICT.BROWSER);

  const readOnly = sd.resolveDestination('deploy-status', config).destination;
  assert.equal(sd.metadataVerdict({ destination: readOnly, orgTypes }).verdict, sd.VERDICT.BROWSER);

  const apexList = sd.resolveDestination('apex-classes', config).destination;
  assert.equal(
    sd.metadataVerdict({ destination: apexList, orgTypes }).verdict,
    sd.VERDICT.BROWSER,
    'reading the Apex class list is not deploying ApexClass'
  );
});

test('an undescribed org or an unlabelled path is UNKNOWN, not a silent pass', () => {
  const adhoc = sd.resolveDestination('lightning/setup/CompanyProfileInfo/home', config).destination;
  assert.equal(sd.metadataVerdict({ destination: adhoc, orgTypes }).verdict, sd.VERDICT.UNKNOWN);

  const destination = sd.resolveDestination('flows', config).destination;
  assert.equal(sd.metadataVerdict({ destination, orgTypes: undefined }).verdict, sd.VERDICT.UNKNOWN);
});

/* ---------- session hand-off ---------- */

test('every shape of Salesforce session URL is recognised as a credential', () => {
  const urls = [
    'https://acme.my.salesforce.com/secur/frontdoor.jsp?sid=00D000000000000%21abc&retURL=%2Flightning',
    'https://acme.my.salesforce.com/services/oauth2/singleaccess?redirect_uri=%2Flightning',
    'https://acme.my.salesforce.com/one/one.app?access_token=00D0abc',
    'force://clientId:secret:refreshToken@acme.my.salesforce.com'
  ];
  for (const url of urls) assert.equal(ss.isCredentialUrl(url), true, url);
  assert.equal(ss.isCredentialUrl('https://acme.my.salesforce.com/lightning/setup/ObjectManager/home'), false);
});

test('redaction masks the secret and keeps the shape', () => {
  const redacted = ss.redactUrl('https://acme.my.salesforce.com/secur/frontdoor.jsp?sid=00D0abc&retURL=%2Flightning');
  assert.match(redacted, /sid=\*\*\*/);
  assert.doesNotMatch(redacted, /00D0abc/);
  assert.match(redacted, /retURL=%2Flightning/, 'the destination stays readable');
  assert.doesNotMatch(ss.redactUrl('force://id:secret:token@acme.my.salesforce.com'), /token/);
});

test('a hand-off URL is loopback, tokenised, and validated on the way in', () => {
  const token = 'a'.repeat(48);
  assert.equal(ss.handoffUrl(1234, token), `http://127.0.0.1:1234/vf-setup/${token}`);
  assert.throws(() => ss.handoffUrl(0, token), /bad port/);
  assert.throws(() => ss.handoffUrl(1234, 'short'), /16-64 hex/);
  assert.equal(ss.parseHandoffPath(`/vf-setup/${token}`), token);
  assert.equal(ss.parseHandoffPath(`/vf-setup/${token}/../../etc`), '');
  assert.equal(ss.parseHandoffPath('/'), '');
});

test('token comparison rejects a prefix and a different length', () => {
  const token = 'f'.repeat(48);
  assert.equal(ss.tokenMatches(token, token), true);
  assert.equal(ss.tokenMatches(token, token.slice(0, 47)), false);
  assert.equal(ss.tokenMatches(token, ''), false);
});

test('a hand-off is served once, from loopback, before it expires', () => {
  const token = 'b'.repeat(48);
  const base = {
    method: 'GET',
    pathname: `/vf-setup/${token}`,
    host: '127.0.0.1:4321',
    token,
    expectedToken: token,
    consumed: false,
    expiresAt: 2_000,
    now: 1_000
  };
  assert.equal(ss.handoffRefusal(base), '');

  assert.equal(ss.handoffRefusal({ ...base, host: 'acme.example.com' }), 'host');
  assert.equal(ss.handoffRefusal({ ...base, method: 'POST' }), 'method');
  assert.equal(ss.handoffRefusal({ ...base, token: 'c'.repeat(48) }), 'token');
  assert.equal(ss.handoffRefusal({ ...base, consumed: true }), 'consumed');
  assert.equal(ss.handoffRefusal({ ...base, now: 3_000 }), 'expired');

  // A non-loopback caller is turned away before the token is even compared.
  assert.equal(ss.handoffRefusal({ ...base, host: 'evil.example.com', token: 'c'.repeat(48) }), 'host');
  assert.equal(ss.REFUSAL_STATUS.host, 421);
  assert.equal(ss.REFUSAL_STATUS.consumed, 410);
});

test('loopback host detection covers ports and IPv6, and nothing else', () => {
  for (const host of ['127.0.0.1', '127.0.0.1:8080', 'localhost', 'localhost:1', '[::1]', '[::1]:9000']) {
    assert.equal(ss.isLoopbackHost(host), true, host);
  }
  for (const host of ['', '10.0.0.5', 'acme.my.salesforce.com', '127.0.0.1.evil.com', 'localhost.evil.com']) {
    assert.equal(ss.isLoopbackHost(host), false, host);
  }
});

/* ---------- browser MCP guards ---------- */

const browserCtx = { config, mode: 'standard', validatedJobs: [], gate: {}, setupGate: [] };

test('a browser tool handed a frontdoor URL is denied and told to use the hand-off', () => {
  const v = evaluateMcp(
    'mcp__playwright__browser_navigate',
    { url: 'https://acme.my.salesforce.com/secur/frontdoor.jsp?sid=00D0abc' },
    browserCtx
  );
  assert.equal(v.decision, DECISION.DENY);
  assert.equal(v.rule, 'browser-credential-url');
  assert.match(v.reason, /vf-setup\.js" serve/, 'the denial carries the command that replaces it');
  assert.doesNotMatch(v.reason, /00D0abc/, 'and it does not echo the session id it just refused');
});

test('a plain org URL passes, with a note when no gate record covers the Setup page', () => {
  const ungated = evaluateMcp(
    'mcp__playwright__browser_navigate',
    { url: 'https://acme-dev.my.salesforce.com/lightning/setup/CompanyProfileInfo/home' },
    browserCtx
  );
  assert.equal(ungated.decision, DECISION.NOTE);
  assert.equal(ungated.rule, 'browser-setup-ungated');

  const gated = evaluateMcp(
    'mcp__playwright__browser_navigate',
    { url: 'https://acme-dev.my.salesforce.com/lightning/setup/CompanyProfileInfo/home' },
    { ...browserCtx, setupGate: [{ path: 'lightning/setup/CompanyProfileInfo/home', alias: 'acme-dev', verdict: 'browser' }] }
  );
  assert.equal(gated.decision, DECISION.PASS);
});

test('a production target in any browser argument is denied unless the override is set', () => {
  const v = evaluateMcp('mcp__playwright__browser_navigate', { url: 'https://acme-prod.my.salesforce.com/lightning' }, browserCtx);
  assert.equal(v.decision, DECISION.DENY);
  assert.equal(v.rule, 'browser-prod-target');

  const relaxed = evaluateMcp(
    'mcp__playwright__browser_navigate',
    { url: 'https://acme-prod.my.salesforce.com/lightning' },
    { ...browserCtx, config: mergeDeep(config, { hooks: { blockProductionDeploy: false } }) }
  );
  assert.equal(relaxed.decision, DECISION.ASK);
});

test('arbitrary page script during a live Setup session asks first', () => {
  const liveSetup = {
    ...browserCtx,
    setupGate: [{ path: 'lightning/setup/ObjectManager/home', alias: 'acme-dev', verdict: 'browser' }]
  };
  const v = evaluateMcp('mcp__playwright__browser_evaluate', { function: '() => document.cookie' }, liveSetup);
  assert.equal(v.decision, DECISION.ASK);
  assert.equal(v.rule, 'browser-page-script');

  const unsafe = evaluateMcp('mcp__playwright__browser_run_code_unsafe', { code: 'await page.goto("x")' }, browserCtx);
  assert.equal(unsafe.decision, DECISION.ASK, 'run_code_unsafe asks whether or not Setup is in flight');

  const idle = evaluateMcp('mcp__playwright__browser_evaluate', { function: '() => 1' }, browserCtx);
  assert.equal(idle.decision, DECISION.PASS, 'no Setup session in flight, no Salesforce concern');
});

test('non-Salesforce browsing is not the plugin\'s business', () => {
  const v = evaluateMcp('mcp__playwright__browser_navigate', { url: 'https://developer.salesforce.com/docs' }, browserCtx);
  assert.equal(v.decision, DECISION.PASS, 'documentation is not an org');
  assert.equal(evaluateMcp('mcp__playwright__browser_snapshot', {}, browserCtx).decision, DECISION.PASS);
});
