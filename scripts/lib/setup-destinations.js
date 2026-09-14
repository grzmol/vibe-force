'use strict';
/**
 * Setup destinations and the metadata-first gate.
 *
 * Clicking in Setup is the last resort, not the first. The Metadata API Developer Guide names the
 * Metadata Coverage Report - not a list in the guide - as "the ultimate source of truth for
 * metadata coverage", so this module never hardcodes what is deployable. It asks the org:
 * `sf org list metadata-types --target-org <alias> --json` returns the `DescribeMetadataResult`
 * for that org and API version, and `metadataObjects[].xmlName` is the authoritative set of types
 * that org can deploy today.
 *
 * The gate: a destination that declares a metadata type the org supports is refused, with the
 * deploy path in the refusal. Only configuration with no metadata route, and read-only
 * inspection, reaches a browser.
 *
 * Paths are facts, so the catalog holds only paths verified in an official artefact. `source`
 * records which one. Everything else is supplied per project through `.vibeforce/config.json`
 * (`setup.destinations`) or as `--path`, discovered by reading the address bar in a real org
 * rather than by guessing a node name.
 */

const VERDICT = { DEPLOY: 'deploy', BROWSER: 'browser', UNKNOWN: 'unknown' };

/**
 * `readOnly` means the destination only shows state. Reading Setup is never a configuration
 * change, so the metadata gate does not apply to it.
 */
const DESTINATIONS = {
  'setup-home': {
    path: 'lightning/setup/SetupOneHome/home',
    metadata: [],
    readOnly: true,
    summary: 'Setup home - the entry point when the node path is not known yet',
    source: 'shipped in vibe-force skills/sf-local-development'
  },
  'deploy-status': {
    path: 'lightning/setup/DeployStatus/home',
    metadata: [],
    readOnly: true,
    summary: 'Deployment Status - a deploy that the CLI already reported, seen from the org side',
    source: 'shipped in vibe-force commands/vf-org.md'
  },
  'apex-jobs': {
    path: 'lightning/setup/AsyncApexJobs/home',
    metadata: [],
    readOnly: true,
    summary: 'Apex Jobs - queued, running and failed async work',
    source: 'shipped in vibe-force commands/vf-org.md'
  },
  'apex-classes': {
    path: 'lightning/setup/ApexClasses/home',
    metadata: ['ApexClass'],
    readOnly: true,
    summary: 'Apex Classes list - read-only; class bodies are source, not Setup',
    source: 'shipped in vibe-force commands/vf-org.md'
  },
  flows: {
    path: 'lightning/setup/Flows/home',
    metadata: ['Flow', 'FlowDefinition'],
    readOnly: false,
    summary: 'Flows - deploy Flow metadata instead; the list is useful to confirm an activation',
    source: '@salesforce/plugin-org messages/open.md, FlowIdNotFound.actions'
  },
  lightning: {
    path: '/lightning',
    metadata: [],
    readOnly: true,
    summary: 'Lightning Experience landing page - the login target Salesforce uses in utam-js-recipes',
    source: 'salesforce/utam-js-recipes scripts/generate-login-url.js'
  }
};

/** A `--path` value has to be a relative navigation path, never an absolute URL. */
function pathProblem(value) {
  const p = String(value == null ? '' : value);
  if (!p) return 'path is empty';
  if (p.length > 512) return 'path is longer than 512 characters';
  if (/[\s\u0000-\u001f\u007f]/.test(p)) return 'path contains whitespace or control characters';
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return 'path must be relative, not an absolute URL - drop the scheme and host';
  if (p.startsWith('//')) return 'path must be relative, not a protocol-relative URL';
  if (p.split('/').includes('..')) return 'path must not contain ..';
  return '';
}

/**
 * `sf org list metadata-types --json` -> the set of xmlNames the org can deploy. Child types
 * (`CustomField` under `CustomObject`) count: a destination that names one is still deployable.
 */
function describedTypes(payload) {
  const result = payload && typeof payload === 'object' ? payload.result || payload : {};
  const objects = Array.isArray(result.metadataObjects) ? result.metadataObjects : [];
  const types = new Set();
  for (const entry of objects) {
    if (entry && typeof entry.xmlName === 'string' && entry.xmlName) types.add(entry.xmlName);
    const children = entry && Array.isArray(entry.childXmlNames) ? entry.childXmlNames : [];
    for (const child of children) if (typeof child === 'string' && child) types.add(child);
  }
  return types;
}

/** Project overrides win over the shipped catalog, so a team can correct a path without a PR. */
function catalog(config) {
  const extra = (config && config.setup && config.setup.destinations) || {};
  const merged = { ...DESTINATIONS };
  for (const [key, value] of Object.entries(extra)) {
    if (!value || typeof value !== 'object' || typeof value.path !== 'string') continue;
    merged[key] = {
      path: value.path,
      metadata: Array.isArray(value.metadata) ? value.metadata.filter((t) => typeof t === 'string') : [],
      readOnly: Boolean(value.readOnly),
      summary: typeof value.summary === 'string' ? value.summary : 'project destination',
      source: `.vibeforce/config.json setup.destinations.${key}`
    };
  }
  return merged;
}

/**
 * Resolve a destination by catalog key or by raw path.
 *
 * A raw `--path` carries no metadata declaration, so the gate cannot clear it on type grounds -
 * `metadataVerdict` returns UNKNOWN for it and the caller has to say what it is changing. That
 * asymmetry is deliberate: an unnamed path is the case where a human has to think.
 */
function resolveDestination(input, config) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return { ok: false, error: 'no destination: pass a catalog key or --path <navigation path>' };
  const entries = catalog(config);
  if (Object.prototype.hasOwnProperty.call(entries, raw)) {
    return { ok: true, destination: { key: raw, ...entries[raw] } };
  }
  const problem = pathProblem(raw);
  if (problem) {
    return { ok: false, error: `${problem}. Known destinations: ${Object.keys(entries).sort().join(', ')}` };
  }
  return {
    ok: true,
    destination: {
      key: '',
      path: raw,
      metadata: [],
      readOnly: false,
      summary: 'ad-hoc path',
      source: 'caller'
    }
  };
}

/**
 * The gate.
 *
 * DEPLOY  - the org supports a metadata type that owns this configuration. Do not click.
 * BROWSER - nothing to deploy, or read-only inspection. A browser is the right tool.
 * UNKNOWN - the org has not been described yet, or the destination declares nothing. The caller
 *           must state what it is changing and check the Metadata Coverage Report.
 */
function metadataVerdict({ destination, orgTypes }) {
  const declared = (destination && Array.isArray(destination.metadata) ? destination.metadata : []).filter(Boolean);
  const readOnly = Boolean(destination && destination.readOnly);
  if (readOnly) {
    return { verdict: VERDICT.BROWSER, types: declared, reason: 'read-only destination: nothing is being configured' };
  }
  if (!declared.length) {
    return {
      verdict: VERDICT.UNKNOWN,
      types: [],
      reason: 'destination declares no metadata type - confirm against the Metadata Coverage Report before clicking'
    };
  }
  if (!(orgTypes instanceof Set)) {
    return {
      verdict: VERDICT.UNKNOWN,
      types: declared,
      reason: 'org has not been described: run vf-setup check --target-org <alias> to fetch its metadata types'
    };
  }
  const supported = declared.filter((type) => orgTypes.has(type));
  if (supported.length) {
    return {
      verdict: VERDICT.DEPLOY,
      types: supported,
      reason: `the org deploys ${supported.join(', ')} through the Metadata API`
    };
  }
  return {
    verdict: VERDICT.BROWSER,
    types: declared,
    reason: `the org does not list ${declared.join(', ')} in describeMetadata, so there is no deploy route`
  };
}

/** The refusal an agent reads. Names the replacement command, never just "denied". */
function deployInsteadHint(destination, types) {
  const list = types && types.length ? types.join(', ') : 'the owning metadata type';
  return [
    `${destination.path} is backed by ${list}, which this org deploys.`,
    'Retrieve it, edit the XML, and deploy:',
    `  sf project retrieve start --metadata ${(types && types[0]) || '<Type>'} --target-org <alias>`,
    '  node "$CLAUDE_PLUGIN_ROOT/scripts/vf-xml.js" outline <file>',
    '  node "$CLAUDE_PLUGIN_ROOT/scripts/checks/vf-check.mjs" deploy-validate --target-org <alias>',
    'Clicking it in Setup produces a change no branch contains.'
  ].join('\n');
}

module.exports = {
  VERDICT,
  DESTINATIONS,
  catalog,
  pathProblem,
  describedTypes,
  resolveDestination,
  metadataVerdict,
  deployInsteadHint
};
