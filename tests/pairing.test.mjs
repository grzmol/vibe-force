/**
 * `vf-check pairing` - the LWC side.
 *
 * Preview-only bundles (`*Harness`, `*Fixtures`) exist so a component can be rendered against
 * fixed data in `sf lightning dev component` and in Jest from one source. They carry no shipped
 * behaviour, so the spec gate must ignore them while still failing on a real bundle.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { run } from '../scripts/checks/lib/pairing.mjs';
import { STATUS } from '../scripts/checks/lib/result.mjs';

const LWC_ROOT = 'force-app/main/default/lwc';

function bundle(root, name, { spec = false } = {}) {
  const dir = path.join(root, LWC_ROOT, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.js`), 'export default class {}\n');
  writeFileSync(path.join(dir, `${name}.js-meta.xml`), '<?xml version="1.0"?>\n');
  if (spec) {
    mkdirSync(path.join(dir, '__tests__'), { recursive: true });
    writeFileSync(path.join(dir, '__tests__', `${name}.test.js`), 'it("renders", () => {});\n');
  }
}

function project(build) {
  const root = mkdtempSync(path.join(tmpdir(), 'vf-pairing-'));
  writeFileSync(
    path.join(root, 'sfdx-project.json'),
    JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }),
  );
  build(root);
  return root;
}

function ctxFor(root, { files = `${LWC_ROOT}/**`, gates = {} } = {}) {
  const warnings = [];
  return {
    projectRoot: root,
    config: { gates: { requireTestForApexClass: false, requireJestForLwc: true, ...gates } },
    args: { files },
    log: { warn: (message) => warnings.push(message), note() {} },
    warnings,
  };
}

test('an LWC bundle without a spec still fails the pairing gate', async () => {
  const root = project((dir) => bundle(dir, 'accountCard'));
  try {
    const result = await run(ctxFor(root));
    assert.equal(result.status, STATUS.FAIL);
    assert.equal(result.raw.lwcMissing, 1);
    assert.match(result.findings[0].message, /accountCard/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preview-only Harness and Fixtures bundles need no spec of their own', async () => {
  const root = project((dir) => {
    bundle(dir, 'accountCard', { spec: true });
    bundle(dir, 'accountCardHarness');
    bundle(dir, 'accountCardFixtures');
  });
  try {
    const result = await run(ctxFor(root));
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
    assert.notEqual(result.status, STATUS.FAIL);
    assert.equal(result.raw.lwcPreviewBundlesSkipped, 2);
    assert.equal(result.raw.lwcModulesChecked, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a scope holding only preview bundles skips, and ignores unpaired bundles outside it', async () => {
  const root = project((dir) => {
    bundle(dir, 'accountCard'); // unpaired, but out of scope
    bundle(dir, 'accountCardHarness');
  });
  try {
    const result = await run(ctxFor(root, { files: `${LWC_ROOT}/accountCardHarness/**` }));
    assert.equal(result.status, STATUS.SKIP);
    assert.equal(result.findings.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every exemption is named in the log', async () => {
  const root = project((dir) => bundle(dir, 'accountCardHarness'));
  try {
    const ctx = ctxFor(root);
    await run(ctx);
    assert.equal(ctx.warnings.length, 1);
    assert.match(ctx.warnings[0], /accountCardHarness.*previewBundlePattern/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a project whose shipped names collide with the default suffixes can narrow the pattern', async () => {
  const root = project((dir) => bundle(dir, 'reportFixtures'));
  try {
    const result = await run(ctxFor(root, { gates: { previewBundlePattern: 'Harness$' } }));
    assert.equal(result.status, STATUS.FAIL);
    assert.match(result.findings[0].message, /reportFixtures/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unusable previewBundlePattern is a misconfiguration, not a silent fallback', async () => {
  const root = project((dir) => bundle(dir, 'accountCard'));
  try {
    await assert.rejects(
      () => run(ctxFor(root, { gates: { previewBundlePattern: '(' } })),
      /previewBundlePattern/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
