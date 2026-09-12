# Wave playbook

Per-wave dispatch briefs, inputs, and hand-off formats. Copy the briefs; they are written to be
pasted into an agent task with the story text substituted.

## Wave 0: scope and contract (serial)

### 0.1 Impact map (`sf-scout`, read-only)

Brief:

```
Story: <story text>

Produce an impact map. Do not edit anything.
1. Metadata in scope: every file a change to this story would touch, grouped by
   classes/triggers, lwc/aura, objects/permissionsets/flows/layouts, namedCredentials/integration.
2. Existing automation on the affected objects: triggers, record-triggered flows, validation
   rules, duplicate rules, process builders. Cite file paths.
3. Existing tests that cover the affected code: Apex test classes and __tests__ files, with the
   methods that touch the story surface.
4. Reuse candidates: existing fields, classes, selectors, services, permission sets, LWC
   components, labels that already do part of the job.
5. Risks: shared files, large profiles, active flow versions, packaging dependencies, data volume.

Output format:
## In scope
<path> | <metadata type> | <why>
## Existing automation
## Existing tests
## Reuse candidates
## Risks
Keep it under 80 lines. Cite file:line for every claim.
```

### 0.2 Scope decision (orchestrator)

Apply the minimal change ladder (skill `sf-minimal-change`) to each requirement, then write
`.vibeforce/state/contract.md` with the decisions, the shared contracts, and the ownership
split. Nothing enters wave 1 that is not in that file.

Checklist before dispatching wave 1:

- [ ] Every requirement maps to an acceptance criterion.
- [ ] Every acceptance criterion maps to exactly one owning agent.
- [ ] Shared signatures, field API names, event payloads and permission set names are fixed.
- [ ] Owned path globs are disjoint. Check with the ownership matrix reference.
- [ ] Baseline is clean: `vf-check static --changed` exits 0 before any edit.
- [ ] Target org for wave 2/3 named, and it is not a production alias.

## Wave 1: build (parallel, one batch)

Brief template, one per engineer, dispatched together:

```
Story: <story text>
Contract: read .vibeforce/state/contract.md first; it is authoritative.

# Target
You own exactly: <glob list>
Non-goals: every other path. If you need a change outside your paths, report it as a contract
change instead of editing it.

# Change
<the slice of the story this agent implements, with the agreed signatures>

# Constraints
- Apply the minimal change ladder before writing: reuse, configure, use platform capability,
  use the framework already present, one line, then custom code.
- Write the tests for your own slice in the same pass (*Test.cls or __tests__/*.test.js).
- Run only narrow checks on your own files. Do not run project-wide gates: siblings are editing
  concurrently and you will fail on their half-written files.
- Do not deploy. Do not run org-touching commands other than read-only queries.

# Acceptance
- Your slice compiles/parses, your own narrow check passes, tests exist for changed behaviour.
- Hand-off report in the format below.
```

Hand-off format (every wave-1 agent):

```
## Changed files
<path> | <what changed> | <test that covers it>
## Contracts published
<signature or API name> | <consumer>
## Checks run
<command> | <exit code> | <summary>
## Residual risk
<risk> | <who should look>
```

## Wave 2: checks (parallel, one batch)

| Agent | Brief core |
| --- | --- |
| `sf-test-engineer` | Run `vf-check jest --changed` and `vf-check apex --target-org <dev>`. Add missing tests for changed behaviour. Never weaken an assertion or lower a threshold to pass. Report coverage per changed class. |
| `sf-quality-gate` | Run `vf-check static --changed --json`. Triage findings into must-fix (at or above `analyzerFailSeverity`), should-fix, and noise with a justification for each dismissal. Do not edit source unless the orchestrator delegates a specific fix, and say so if it does. |
| `sf-security-reviewer` | Review the diff against skill `sf-security-model`: CRUD/FLS, sharing, injection, secrets, LWS constraints, permission set scope. Read-only. Every finding gets `file:line`, severity, and the concrete fix. |

Wave gate:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --changed
```

Failure routing:

| Finding type | Routed to |
| --- | --- |
| Apex logic, bulkification, governor limits | `sf-apex-engineer` |
| LWC behaviour, accessibility, Jest | `sf-lwc-engineer` |
| Field/permission/flow metadata | `sf-metadata-engineer` |
| Callout, credential, event wiring | `sf-integration-engineer` |
| Missing or weak test | `sf-test-engineer` |
| Scope creep, new abstraction with one caller | orchestrator (drop it) |

## Wave 3: deploy (serial)

```bash
# clean local gate first, on the whole change set, not just --changed
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local

# validate: runs tests in the org, commits nothing
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-validate --target-org acme-uat

# read the recorded job before deploying
jq '.jobs[-1]' .vibeforce/state/deploy-jobs.json

# quick deploy the validated job
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-quick --target-org acme-uat
```

Hand-off:

```
## Deployment
job id | target org | test level | components | tests run | pass/fail | duration
## Destructive changes
<component> | pre/post | reviewed by
## Follow-up required in org
<manual step> | owner
```

Production adds: explicit human approval recorded in the session, `VF_ALLOW_PROD=1` set by the
human, release window confirmed, and rollback plan written before the quick deploy.

## Wave 4: verify (parallel, one batch)

| Agent | Brief core |
| --- | --- |
| `sf-org-verifier` | `vf-check smoke --target-org <alias>`; verification queries for the story's data and configuration; `sf org list limits`; scan recent logs and `AsyncApexJob` failures; write diagnostics to `.vibeforce/reports/`. |
| `sf-test-engineer` | `vf-check apex --target-org <alias> --tests <story test classes>`; report per-class coverage and any newly failing unrelated test. |

Verdict table the orchestrator produces:

```
| check | result | evidence |
| deploy report | pass | job 0Af..., 34 components, 0 failures |
| org tests | pass | 12 tests, 0 failures, class coverage 91% |
| smoke probes | pass | 5/5 probes, report .vibeforce/reports/smoke-2026-...json |
| data verification | pass | 128 cases with escalation reason, 0 orphans |
| limits | pass | API usage 3% of daily allocation |
| story acceptance | pass | criterion 1..n each with the observation that proves it |
```

Then the decision: done, forward-fix (new wave 1 for the specific defect), or rollback (see
`references/failure-and-rollback.md`).
