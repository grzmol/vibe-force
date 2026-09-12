/**
 * `pairing` - static test-coverage pairing, run as part of `static`.
 *
 * Enforces two config gates that no external tool covers:
 *   gates.requireTestForApexClass  every non-test Apex class and trigger has a test class
 *   gates.requireJestForLwc        every LWC module with JavaScript has a __tests__ spec
 *
 * The Apex side looks for the conventional test-class names and, failing that, for a test class
 * whose body references the class, so existing suites that use a shared test class still pass.
 */

import fs from 'node:fs';
import path from 'node:path';
import { packageDirectories } from './config.mjs';
import { classify, resolveTargets, walk } from './files.mjs';
import { booleanGate, gateConfig } from './gates.mjs';
import { EXIT, VfError, fail, finding, makeResult, skip } from './result.mjs';

/**
 * Preview-only bundles. `<name>Harness` mounts a component against fixed data for
 * `sf lightning dev component`; `<name>Fixtures` is the state module the harness and the Jest
 * spec both import. Neither carries shipped behaviour, so neither needs a spec of its own -
 * see skill `sf-local-development`, pattern 9.
 *
 * The default suffixes are a naming convention, not a fact about the bundle, so a project whose
 * shipped components collide with them narrows `gates.previewBundlePattern`. Every exemption is
 * named in the log: a silently skipped bundle is a gate that fails open.
 */
function previewMatcher(pattern) {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new VfError(
      `gates.previewBundlePattern is not a valid regular expression: ${pattern}`,
      EXIT.CONFIG,
      `Fix it in .vibeforce/config.json (${error.message}), or remove it to fall back to the default.`,
    );
  }
}

const TEST_NAME_PATTERNS = [
  (name) => `${name}Test`,
  (name) => `${name}Tests`,
  (name) => `Test${name}`,
  (name) => `${name}_Test`,
  (name) => `${name}TestClass`,
];

function isTestSource(file, projectRoot) {
  try {
    const text = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    return /@\s*istest/i.test(text);
  } catch {
    return false;
  }
}

function readSource(projectRoot, file) {
  try {
    return fs.readFileSync(path.join(projectRoot, file), 'utf8');
  } catch {
    return '';
  }
}

export async function run(ctx) {
  const result = makeResult('pairing');
  const gates = gateConfig(ctx.config);

  if (!gates.requireTestForApexClass && !gates.requireJestForLwc) {
    return skip(result, 'both pairing gates are disabled');
  }

  const targets = await resolveTargets(ctx);
  if (targets.warning) ctx.log.warn(targets.warning);

  const pkgDirs = packageDirectories(ctx);
  const allFiles = pkgDirs.flatMap((dir) => {
    const abs = path.join(ctx.projectRoot, dir);
    return fs.existsSync(abs) ? walk(abs, { relativeTo: ctx.projectRoot }) : [];
  });

  const scope = classify(targets.files);
  const everything = classify(allFiles);

  const apexTestNames = new Set(
    everything.apexTests.map((file) => path.basename(file, path.extname(file))),
  );
  const apexTestBodies = everything.apexTests.map((file) => ({
    file,
    text: readSource(ctx.projectRoot, file),
  }));

  let apexMissing = 0;
  if (gates.requireTestForApexClass) {
    const candidates = [...scope.apexClasses, ...scope.apexTriggers].filter(
      (file) => !isTestSource(file, ctx.projectRoot),
    );
    for (const file of candidates) {
      const name = path.basename(file, path.extname(file));
      const conventional = TEST_NAME_PATTERNS.map((build) => build(name)).some((candidate) =>
        apexTestNames.has(candidate),
      );
      const referenced =
        conventional ||
        apexTestBodies.some(({ text }) => new RegExp(`\\b${name}\\b`).test(text));
      if (!referenced) {
        apexMissing += 1;
        result.findings.push(
          finding({
            severity: 2,
            file,
            rule: 'vf/requireTestForApexClass',
            engine: 'vibe-force',
            message: `No Apex test covers ${name}. Add ${name}Test.cls, or reference ${name} from an existing @isTest class.`,
          }),
        );
      }
    }
  }

  let lwcMissing = 0;
  let lwcPreview = 0;
  if (gates.requireJestForLwc) {
    const isPreviewBundle = previewMatcher(gates.previewBundlePattern);
    for (const moduleDir of scope.lwcModules) {
      const abs = path.join(ctx.projectRoot, moduleDir);
      if (!fs.existsSync(abs)) continue;
      const name = path.basename(moduleDir);
      if (isPreviewBundle.test(name)) {
        lwcPreview += 1;
        ctx.log.warn(`pairing: ${name} exempt from the Jest spec gate (gates.previewBundlePattern)`);
        continue;
      }
      const hasJs = fs.existsSync(path.join(abs, `${name}.js`));
      const hasMeta = fs.existsSync(path.join(abs, `${name}.js-meta.xml`));
      if (!hasJs || !hasMeta) continue;

      const testsDir = path.join(abs, '__tests__');
      const specs = fs.existsSync(testsDir)
        ? fs.readdirSync(testsDir).filter((entry) => /\.(test|spec)\.[jt]s$/.test(entry))
        : [];
      if (specs.length === 0) {
        lwcMissing += 1;
        result.findings.push(
          finding({
            severity: 2,
            file: `${moduleDir}/${name}.js`,
            rule: 'vf/requireJestForLwc',
            engine: 'vibe-force',
            message: `No Jest spec for LWC ${name}. Add ${moduleDir}/__tests__/${name}.test.js.`,
          }),
        );
      }
    }
  }

  result.gates = [
    ...(gates.requireTestForApexClass ? [booleanGate('apexTestPairing', apexMissing === 0)] : []),
    ...(gates.requireJestForLwc ? [booleanGate('lwcJestPairing', lwcMissing === 0)] : []),
  ];
  result.raw = {
    mode: targets.mode,
    apexClassesChecked: scope.apexClasses.length + scope.apexTriggers.length,
    lwcModulesChecked: scope.lwcModules.length - lwcPreview,
    lwcPreviewBundlesSkipped: lwcPreview,
    apexMissing,
    lwcMissing,
  };
  result.detail = `${scope.apexClasses.length + scope.apexTriggers.length} Apex sources, ${scope.lwcModules.length - lwcPreview} LWC modules${lwcPreview > 0 ? ` (+${lwcPreview} preview-only)` : ''}; ${apexMissing + lwcMissing} unpaired`;

  if (apexMissing + lwcMissing > 0) return fail(result, result.detail);
  if (scope.apexClasses.length + scope.apexTriggers.length + scope.lwcModules.length - lwcPreview === 0) {
    return skip(result, `no Apex or LWC sources in scope (${targets.mode})`);
  }
  return result;
}
