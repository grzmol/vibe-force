'use strict';
/**
 * Salesforce path classification.
 *
 * Used by the hooks to decide which wave-1 agent owns a file, whether a file is
 * Apex/LWC/metadata, whether it is generated (never editable), and which local
 * check is relevant after an edit.
 */

const path = require('node:path');

const GENERATED_DIRS = ['.sfdx', '.sf', '.localdevserver', 'node_modules', '.vibeforce/state', '.vibeforce/reports'];

/** wave-1 slice -> owning agent + the path patterns it may write. */
const SLICES = {
  apex: {
    agent: 'sf-apex-engineer',
    patterns: [/\/classes\//, /\/triggers\//]
  },
  lwc: {
    agent: 'sf-lwc-engineer',
    patterns: [/\/lwc\//, /\/aura\//, /\/staticresources\//]
  },
  metadata: {
    agent: 'sf-metadata-engineer',
    patterns: [
      /\/objects\//,
      /\/permissionsets\//,
      /\/permissionsetgroups\//,
      /\/profiles\//,
      /\/flows\//,
      /\/layouts\//,
      /\/flexipages\//,
      /\/labels\//,
      /\/settings\//,
      /\/tabs\//,
      /\/applications\//,
      /\/quickActions\//,
      /\/globalValueSets\//,
      /\/recordTypes\//,
      // Agentforce: agent definitions are metadata, their actions are Apex and stay in the apex slice
      /\/bots\//,
      /\/botVersions\//,
      /\/aiAuthoringBundles\//,
      /\/aiEvaluationDefinitions\//,
      /\/genAiPlanners\//,
      /\/genAiPlannerBundles\//,
      /\/genAiPlugins\//,
      /\/genAiFunctions\//,
      /\/genAiPromptTemplates\//,
      // Data Cloud
      /\/dataStreamDefinitions\//,
      /\/mktCalcInsightObjectDefs\//
    ]
  },
  integration: {
    agent: 'sf-integration-engineer',
    // Directory names are the ones in the official metadata registry
    // (forcedotcom/source-deploy-retrieve, src/registry/metadataRegistry.json), not the type
    // names: ExternalServiceRegistration lives in externalServiceRegistrations/, and
    // ExternalClientApplication - the successor to ConnectedApp - in externalClientApps/.
    // scripts/dev/verify-metadata-dirs.mjs keeps this list honest.
    patterns: [
      /\/namedCredentials\//,
      /\/externalCredentials\//,
      /\/externalServiceRegistrations\//,
      /\/externalClientApps\//,
      /\/dataSources\//,
      /\/platformEventChannels\//,
      /\/platformEventChannelMembers\//,
      /\/remoteSiteSettings\//,
      /\/connectedApps\//,
      /\/authproviders\//
    ]
  }
};

const KINDS = [
  { kind: 'apex-test', test: (p) => /\.cls$/i.test(p) && /(test|_tests?)\.cls$/i.test(p) },
  { kind: 'apex-class', test: (p) => /\.cls$/i.test(p) },
  { kind: 'apex-trigger', test: (p) => /\.trigger$/i.test(p) },
  { kind: 'apex-anonymous', test: (p) => /\.apex$/i.test(p) },
  { kind: 'lwc-test', test: (p) => /\/lwc\/.*__tests__\/.*\.(js|ts)$/i.test(p) },
  { kind: 'lwc-js', test: (p) => /\/lwc\/[^/]+\/[^/]+\.js$/i.test(p) },
  { kind: 'lwc-html', test: (p) => /\/lwc\/[^/]+\/[^/]+\.html$/i.test(p) },
  { kind: 'lwc-css', test: (p) => /\/lwc\/[^/]+\/[^/]+\.css$/i.test(p) },
  { kind: 'aura', test: (p) => /\/aura\//i.test(p) },
  { kind: 'flow', test: (p) => /\.flow-meta\.xml$/i.test(p) },
  { kind: 'profile', test: (p) => /\.profile-meta\.xml$/i.test(p) },
  { kind: 'permissionset', test: (p) => /\.permissionset(-meta)?\.xml$/i.test(p) },
  { kind: 'object', test: (p) => /\.object-meta\.xml$/i.test(p) },
  { kind: 'field', test: (p) => /\/fields\/[^/]+\.field-meta\.xml$/i.test(p) },
  { kind: 'named-credential', test: (p) => /\.(namedCredential|externalCredential)-meta\.xml$/i.test(p) },
  { kind: 'metadata-xml', test: (p) => /-meta\.xml$/i.test(p) || /\.xml$/i.test(p) }
];

function normalise(filePath) {
  return String(filePath || '').split(path.sep).join('/');
}

function isGenerated(filePath) {
  const p = normalise(filePath);
  return GENERATED_DIRS.some((dir) => p.includes(`/${dir}/`) || p.startsWith(`${dir}/`));
}

function classify(filePath) {
  const p = normalise(filePath);
  const kind = (KINDS.find((k) => k.test(p)) || { kind: 'other' }).kind;
  let slice = null;
  for (const [name, def] of Object.entries(SLICES)) {
    if (def.patterns.some((re) => re.test(p))) {
      slice = name;
      break;
    }
  }
  // integration Apex lives under classes/ but belongs to the integration slice
  if (slice === 'apex' && /\/classes\/integration\//.test(p)) slice = 'integration';
  return {
    path: p,
    kind,
    slice,
    owner: slice ? SLICES[slice].agent : null,
    generated: isGenerated(p),
    isApex: kind.startsWith('apex-'),
    isLwc: kind.startsWith('lwc-'),
    isMetadataXml: kind !== 'other' && /xml$/i.test(p),
    isTest: kind === 'apex-test' || kind === 'lwc-test'
  };
}

/** Local checks worth running after touching this file. */
function checksFor(info) {
  if (info.isApex) return ['analyzer', 'format'];
  if (info.kind === 'lwc-test' || info.isLwc) return ['lint', 'jest', 'format'];
  if (info.isMetadataXml) return ['format'];
  return [];
}

/** Apex class -> expected test class candidates. */
function expectedApexTest(filePath) {
  const p = normalise(filePath);
  const m = p.match(/^(.*)\/([^/]+)\.cls$/i);
  if (!m) return [];
  const [, dir, name] = m;
  return [`${dir}/${name}Test.cls`, `${dir}/${name}_Test.cls`, `${dir}/Test${name}.cls`];
}

/** LWC module -> expected jest test path. */
function expectedLwcTest(filePath) {
  const p = normalise(filePath);
  const m = p.match(/^(.*\/lwc\/([^/]+))\/\2\.js$/i);
  if (!m) return [];
  return [`${m[1]}/__tests__/${m[2]}.test.js`];
}

module.exports = { SLICES, classify, checksFor, isGenerated, expectedApexTest, expectedLwcTest, normalise };
