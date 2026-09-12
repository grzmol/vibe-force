/**
 * Composite checks: `static`, `local`, `verify`, `all`.
 *
 *   static  format + lint + analyzer + pairing        (no org)
 *   local   static + jest                             (no org) - the full local gate
 *   verify  apex + smoke                              (org)
 *   all     local + apex + smoke                      (org)
 *
 * Sequencing is deliberate: cheap checks run first so a formatting failure does not wait for a
 * Code Analyzer run. A step that fails does not stop the sequence - the operator gets every
 * problem in one pass - but an org error aborts the remaining org steps, because every later step
 * would fail for the same reason.
 *
 * Degradation: a missing external tool marks the step `skipped`. Inside a composite that is a
 * warning unless `--strict` is passed, in which case it fails the composite with exit code 2.
 */

import { EXIT, STATUS, makeResult, worseStatus } from './result.mjs';

export const COMPOSITES = {
  static: ['format', 'lint', 'analyzer', 'pairing'],
  local: ['format', 'lint', 'analyzer', 'pairing', 'jest'],
  verify: ['apex', 'smoke'],
  all: ['format', 'lint', 'analyzer', 'pairing', 'jest', 'apex', 'smoke'],
};

const ORG_STEPS = new Set(['apex', 'smoke', 'deploy-validate', 'deploy-quick']);

export function isComposite(check) {
  return Object.hasOwn(COMPOSITES, check);
}

export async function run(ctx, { runStep }) {
  const steps = COMPOSITES[ctx.check];
  const result = makeResult(ctx.check);
  let orgFailed = false;

  for (const step of steps) {
    if (orgFailed && ORG_STEPS.has(step)) {
      const skipped = makeResult(step, {
        status: STATUS.SKIP,
        detail: 'skipped after an earlier org error',
      });
      result.steps.push(skipped);
      ctx.log.status(skipped);
      continue;
    }

    const stepResult = await runStep(step);
    result.steps.push(stepResult);
    ctx.log.status(stepResult);

    result.findings.push(...(stepResult.findings ?? []));
    result.gates.push(
      ...(stepResult.gates ?? []).map((gate) => ({ ...gate, name: `${step}.${gate.name}` })),
    );

    if (stepResult.status === STATUS.SKIP) {
      if (ctx.args.strict) {
        result.status = STATUS.FAIL;
        result.exitCode = Math.max(result.exitCode, EXIT.CONFIG);
      } else {
        // `log.status` already printed the hint; do not repeat it.
        result.status = worseStatus(result.status, STATUS.SKIP);
      }
      continue;
    }

    if (stepResult.status === STATUS.FAIL) {
      result.status = STATUS.FAIL;
      result.exitCode = Math.max(result.exitCode, stepResult.exitCode || EXIT.GATE);
      if (stepResult.exitCode === EXIT.ORG) orgFailed = true;
    }
  }

  const failed = result.steps.filter((step) => step.status === STATUS.FAIL);
  const skippedSteps = result.steps.filter((step) => step.status === STATUS.SKIP);
  result.detail = `${result.steps.length - failed.length - skippedSteps.length}/${result.steps.length} passed${failed.length ? `, failed: ${failed.map((step) => step.check).join(', ')}` : ''}${skippedSteps.length ? `, skipped: ${skippedSteps.map((step) => step.check).join(', ')}` : ''}`;
  result.raw = {
    sequence: steps,
    strict: Boolean(ctx.args.strict),
  };

  // A composite whose every step was skipped never proved anything; say so rather than pass.
  if (skippedSteps.length === result.steps.length && result.steps.length > 0) {
    result.status = STATUS.SKIP;
    result.detail = `every step skipped (${skippedSteps.map((step) => step.check).join(', ')})`;
  }

  return result;
}
