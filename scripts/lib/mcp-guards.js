'use strict';
/**
 * Deterministic guard rules for MCP tool calls.
 *
 * MCP tools reach an org without going through Bash, so `bash-guards.js` never sees them: an
 * agent holding `deploy_metadata` can push to production without a validated job id, and
 * `retrieve_metadata` writes files without passing the Edit hook that enforces path ownership.
 * These rules close both holes.
 *
 * Pure functions only. `evaluate()` takes the tool name plus its arguments and returns a
 * decision; the PreToolUse handler does the I/O.
 */

const { isProductionTarget } = require('./config');
const { isCredentialUrl, redactUrl } = require('./setup-session');

const DECISION = { PASS: 'pass', ASK: 'ask', DENY: 'deny', NOTE: 'note' };

/** `mcp__salesforce-dx__deploy_metadata` -> { server: 'salesforce-dx', tool: 'deploy_metadata' }. */
function parseToolName(name) {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(String(name || ''));
  if (!m) return { server: '', tool: String(name || ''), isMcp: false };
  return { server: m[1], tool: m[2], isMcp: true };
}

/**
 * Every string in the arguments, flattened. The DX MCP tools name their org argument differently
 * per tool, so the guard matches on values rather than trusting one argument name.
 */
function stringValues(input, acc = [], depth = 0) {
  if (depth > 6 || input == null) return acc;
  if (typeof input === 'string') {
    acc.push(input);
    return acc;
  }
  if (Array.isArray(input)) {
    for (const item of input) stringValues(item, acc, depth + 1);
    return acc;
  }
  if (typeof input === 'object') {
    for (const value of Object.values(input)) stringValues(value, acc, depth + 1);
  }
  return acc;
}

/** The production alias named anywhere in the arguments, or '' when none is. */
function productionTarget(input, config) {
  for (const value of stringValues(input)) {
    if (value && isProductionTarget(config, value)) return value;
  }
  return '';
}

/**
 * Salesforce org hosts as the documentation spells them: `<mydomain>.my.salesforce.com` (core and
 * Setup, sandboxes included via `--<name>.sandbox.my.salesforce.com`), `.lightning.force.com`,
 * `.my.site.com` and `.visualforce.com`. developer.salesforce.com is documentation, not an org.
 */
const ORG_HOST = /https?:\/\/[^/\s"']+\.(?:my\.salesforce\.com|lightning\.force\.com|my\.site\.com|visualforce\.com)(?:[:/]|$)/i;
const SETUP_PATH = /\/lightning\/setup\//i;
const BROWSER_TOOL = /^browser_/;
const PAGE_SCRIPT_TOOL = /^browser_(?:evaluate|run_code_unsafe)$/;

function browserUrls(input) {
  return stringValues(input).filter((v) => /^https?:\/\//i.test(v) || /^\/vf-setup\//.test(v));
}

function setupGateEntries(ctx) {
  return Array.isArray(ctx && ctx.setupGate) ? ctx.setupGate : [];
}

/** A gate record covers a URL when the recorded navigation path appears in it. */
function gateCovers(ctx, url) {
  return setupGateEntries(ctx).some((entry) => {
    const p = entry && typeof entry.path === 'string' ? entry.path.replace(/^\/+/, '') : '';
    return p && url.includes(p);
  });
}

const RULES = [
  {
    id: 'mcp-prod-deploy',
    match: (tool) => tool === 'deploy_metadata',
    decide: (tool, input, ctx) => {
      const org = productionTarget(input, ctx.config);
      if (!org) return { decision: DECISION.PASS };
      if (ctx.config.hooks && ctx.config.hooks.blockProductionDeploy === false) {
        return {
          decision: DECISION.ASK,
          reason: `deploy_metadata targets the production alias ${org} with VF_ALLOW_PROD=1. Confirm the change set and the test level before proceeding.`
        };
      }
      return {
        decision: DECISION.DENY,
        reason: `deploy_metadata targets the production alias ${org}. MCP deploys skip the validate + quick-deploy path and leave no job id in .vibeforce/state/deploy-jobs.json. Run \`vf-check deploy-validate --target-org ${org}\` then \`vf-check deploy-quick --target-org ${org}\`. See skill sf-deployment-strategies.`
      };
    }
  },
  {
    id: 'mcp-deploy-bypasses-gate',
    match: (tool) => tool === 'deploy_metadata',
    decide: (tool, input, ctx) => {
      if (productionTarget(input, ctx.config)) return { decision: DECISION.PASS };
      if (ctx.gate && ctx.gate.status === 'pass') return { decision: DECISION.PASS };
      return {
        decision: DECISION.NOTE,
        reason:
          'deploy_metadata does not run the local gate. Run `vf-check local --changed` first; a deploy that skips it moves failing source into an org.'
      };
    }
  },
  {
    id: 'mcp-retrieve-ignores-ownership',
    match: (tool) => tool === 'retrieve_metadata',
    decide: () => ({
      decision: DECISION.NOTE,
      reason:
        'retrieve_metadata writes project files without passing the edit guard, so it can overwrite a file another wave-1 agent holds. Retrieve between waves, not during one, and re-run `vf-check static --changed` afterwards.'
    })
  },
  {
    id: 'mcp-prod-mutation',
    match: (tool) => ['assign_permission_set', 'create_org_snapshot', 'enrich_metadata'].includes(tool),
    decide: (tool, input, ctx) => {
      const org = productionTarget(input, ctx.config);
      if (!org) return { decision: DECISION.PASS };
      return {
        decision: DECISION.ASK,
        reason: `${tool} changes the production org ${org}. Production changes need an explicit human decision and a record of what changed.`
      };
    }
  },
  {
    id: 'mcp-prod-org-delete',
    match: (tool) => tool === 'delete_org' || /(^|_)(delete|destroy)_/.test(tool),
    decide: (tool, input, ctx) => {
      const org = productionTarget(input, ctx.config);
      if (!org) return { decision: DECISION.PASS };
      return {
        decision: DECISION.DENY,
        reason: `${tool} names the production alias ${org}. Destructive operations on production are blocked; set VF_ALLOW_PROD=1 only with explicit human approval.`
      };
    }
  },
  {
    id: 'mcp-prod-test-run',
    match: (tool) => tool === 'run_apex_test' || tool === 'run_agent_test',
    decide: (tool, input, ctx) => {
      const org = productionTarget(input, ctx.config);
      if (!org) return { decision: DECISION.PASS };
      return {
        decision: DECISION.ASK,
        reason: `${tool} runs tests in the production org ${org}. Test runs consume production limits and execute triggers; confirm this is intended.`
      };
    }
  },
  {
    id: 'browser-credential-url',
    match: (tool, input) => BROWSER_TOOL.test(tool) && stringValues(input).some((v) => isCredentialUrl(v)),
    decide: (tool, input) => ({
      decision: DECISION.DENY,
      reason:
        'That URL is a session credential, and a tool argument is transcript. ' +
        `Saw: ${redactUrl(browserUrls(input)[0] || stringValues(input)[0] || '')}\n` +
        'Hand the browser a single-use loopback redirect instead:\n' +
        '  node "$CLAUDE_PLUGIN_ROOT/scripts/vf-setup.js" serve <dest> --target-org <alias>\n' +
        'then navigate to the http://127.0.0.1:<port>/vf-setup/<token> URL it prints.'
    })
  },
  {
    id: 'browser-prod-target',
    match: (tool, input, ctx) => BROWSER_TOOL.test(tool) && Boolean(productionTarget(input, ctx.config)),
    decide: (tool, input, ctx) => {
      const target = productionTarget(input, ctx.config);
      const blocking = !ctx.config || !ctx.config.hooks || ctx.config.hooks.blockProductionDeploy !== false;
      return {
        decision: blocking ? DECISION.DENY : DECISION.ASK,
        reason:
          `${target} is a production target. Driving production Setup from a browser makes a change ` +
          'no branch contains and no deploy can reproduce. Do it in a sandbox and deploy the metadata. ' +
          'If it genuinely has no metadata route, re-run with VF_ALLOW_PROD=1 and say why.'
      };
    }
  },
  {
    id: 'browser-setup-ungated',
    match: (tool, input, ctx) =>
      BROWSER_TOOL.test(tool) &&
      browserUrls(input).some((url) => ORG_HOST.test(url) && SETUP_PATH.test(url)) &&
      !browserUrls(input).every((url) => !SETUP_PATH.test(url) || gateCovers(ctx, url)),
    decide: () => ({
      decision: DECISION.NOTE,
      reason:
        'Setup page with no metadata-first gate record. Run ' +
        '`node "$CLAUDE_PLUGIN_ROOT/scripts/vf-setup.js" check <dest> --target-org <alias>` first: if the org ' +
        'deploys the type that owns this page, clicking it produces drift instead of a deployable change.'
    })
  },
  {
    id: 'browser-page-script',
    match: (tool, input, ctx) =>
      PAGE_SCRIPT_TOOL.test(tool) && (tool === 'browser_run_code_unsafe' || setupGateEntries(ctx).length > 0),
    decide: (tool) => ({
      decision: DECISION.ASK,
      reason:
        `${tool} runs arbitrary code in a page that holds a logged-in Salesforce session. ` +
        'Prefer browser_snapshot, browser_click and browser_fill_form, which are auditable actions.'
    })
  }
];

/**
 * @param {string} toolName the raw PreToolUse tool name, e.g. mcp__salesforce-dx__deploy_metadata
 * @param {object} input the tool arguments
 * @param {{config:object, mode?:string, gate?:object, setupGate?:object[]}} ctx
 * @returns {{decision:string, reason?:string, rule?:string, tool?:string, server?:string}}
 */
function evaluate(toolName, input, ctx) {
  const context = Object.assign({ mode: 'standard', config: { hooks: {} }, gate: {} }, ctx);
  const { server, tool, isMcp } = parseToolName(toolName);
  if (!isMcp) return { decision: DECISION.PASS };

  const args = input || {};
  const notes = [];
  for (const rule of RULES) {
    if (!rule.match(tool, args, context)) continue;
    const result = rule.decide(tool, args, context) || { decision: DECISION.PASS };
    if (result.decision === DECISION.DENY || result.decision === DECISION.ASK) {
      return { decision: result.decision, reason: result.reason, rule: rule.id, tool, server };
    }
    if (result.decision === DECISION.NOTE) notes.push({ rule: rule.id, reason: result.reason });
  }
  if (notes.length) {
    return {
      decision: DECISION.NOTE,
      reason: notes.map((n) => n.reason).join(' '),
      rule: notes.map((n) => n.rule).join(','),
      tool,
      server
    };
  }
  return { decision: DECISION.PASS, tool, server };
}

module.exports = { DECISION, RULES, evaluate, parseToolName, productionTarget, stringValues };
