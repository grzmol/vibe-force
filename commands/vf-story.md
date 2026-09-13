---
description: Deliver a Salesforce story end to end through the vibe-force wave workflow - scout, parallel build, parallel checks, serial validated deploy, parallel post-deploy verification.
argument-hint: "<user story or requirement>"
allowed-tools: Task, Read, Write, Edit, Glob, Grep, Bash(node:*), Bash(git status:*), Bash(git diff:*), Bash(git merge-base:*)
---

# vf-story - run the full parallel delivery workflow

Story: `$ARGUMENTS`

If the story is empty, ask for it and stop. Everything below runs in one turn unless a gate fails or an abort
condition fires. `PROJECT` is the current project root; `PLUGIN` is `${CLAUDE_PLUGIN_ROOT}`.

## Rules that bind every wave

1. A wave starts only after the previous wave's gate passed. No agent from wave N+1 is dispatched while a wave-N
   agent is still running.
2. Every agent inside one wave is dispatched in a **single parallel batch** - one tool call carrying all of that
   wave's tasks. Dispatching them one after another is a workflow violation, not a style preference.
3. Wave-1 agents own disjoint paths. An agent that needs a file outside its ownership asks the owning agent
   instead of editing it.
4. Cross-slice contracts (Apex method signatures consumed by LWC, field API names, permission set names, event
   payloads) are fixed in wave 0 and written to `.vibeforce/state/contract.md`. Nobody renegotiates them mid-wave.
5. Skip no wave. If a wave has no work (for example no LWC in scope), record that and move on.
6. Scope passes the minimal-change ladder in "Wave 0.5" before any build agent is dispatched. Wave-1 agents
   receive a decided solution shape, not a blank slate.

## Wave 0 - scout (serial, one agent)

Dispatch `sf-scout` with the story text. It must return, and you must read, before anything else:

- The impacted metadata: existing Apex classes, triggers, LWC bundles, objects, fields, flows, permission sets.
- Dependencies and callers of each impacted component.
- Existing test classes and Jest specs covering them, with current coverage if known.
- Gaps: what does not exist yet and has to be created.
- Risks: bulkification, sharing, governor limits, retired API usage.

Then write `.vibeforce/state/contract.md` yourself. It must contain:

| Section | Content |
| --- | --- |
| Story | the story text, restated as acceptance criteria |
| Solution shape | the ladder result from wave 0.5: the chosen mechanism for each requirement and what was rejected |
| Path ownership | the four wave-1 slices and the exact directories each one owns |
| Apex surface | every class and method signature that another slice calls, with `with sharing` decision |
| Data surface | object and field API names, types, and the permission set that grants them |
| Integration surface | named credential, external service, and platform event API names |
| Test surface | which test classes and Jest specs must exist when wave 2 runs |
| Out of scope | what this story explicitly does not change |

**Gate 0**: the contract names every cross-slice symbol. If a signature is still open, resolve it now - a wave-1
agent must never invent one.

## Wave 0.5 - minimal-change ladder (serial, before any build agent)

Take every requirement the story actually states and push it down this ladder. Stop at the first rung that
satisfies the requirement; record the rung you stopped on and the rungs you rejected in the `Solution shape`
section of `.vibeforce/state/contract.md`.

| Rung | Ask | Stop here when |
| --- | --- | --- |
| 1. Drop it | Does the story actually require this? | It does not. Delete it from scope, including anything "while we are here" |
| 2. Reuse | Does this already exist in the repo or the org? | Scout found a class, component, field, permission set, or flow that covers it |
| 3. Configure | Can declarative platform configuration do it - validation rule, formula field, rollup summary, record-triggered Flow, sharing rule, permission set? | Configuration meets the acceptance criteria |
| 4. Use the platform | Is there a standard capability instead of a hand-rolled one - base Lightning components, Lightning Data Service (`lightning/uiRecordApi`), standard REST/Composite/Bulk APIs, Named Credentials for callout auth? | The standard capability covers the case |
| 5. Follow the project | Does the project already have a convention for this - a trigger handler framework, a selector or service layer, an error logger, a test data factory? | Reuse it. Never introduce a second convention beside an existing one |
| 6. One line | Does one line, one attribute, or one metadata field suffice - a `WHERE` clause, a `required` attribute, a field-level default? | It does |
| 7. Build it | Only now: the minimum custom Apex and LWC that meets the acceptance criteria | Nothing above it applies |

What the ladder never trades away. These are the floor, not a rung, and apply to whatever shape wins:

- CRUD and FLS enforcement, and an explicit sharing declaration on every Apex class.
- Bulkification: no SOQL, DML, or callouts inside loops; every entry point works for 200 records.
- Error handling that surfaces a real message instead of swallowing the exception.
- Tests for every behaviour this story changes.
- LWC accessibility: labels, keyboard reachability, focus handling, announced errors.
- Data-loss safety: no destructive change without an explicit, reviewed decision.

**Gate 0.5**: every requirement has a recorded rung, and the rejected rungs name why they were rejected. A
requirement with no recorded rung is not ready for wave 1.

## Wave 1 - build (parallel, one batch)

Dispatch all applicable agents in one batch. Give each one the story, the path to `.vibeforce/state/contract.md`,
the `Solution shape` rows that belong to its slice, its owned paths, and the explicit instruction not to run
project-wide validation. A slice whose ladder result was "drop it", "reuse", or "configure" gets no build agent -
the metadata engineer implements the configuration instead.

| Agent | Owns (under each package directory's `main/default/`) |
| --- | --- |
| `sf-apex-engineer` | `classes/`, `triggers/` |
| `sf-lwc-engineer` | `lwc/`, `aura/`, `staticresources/` |
| `sf-metadata-engineer` | `objects/`, `permissionsets/`, `flows/`, `layouts/`, `flexipages/`, `labels/` |
| `sf-integration-engineer` | `namedCredentials/`, `externalCredentials/`, `externalServiceRegistrations/`, `externalClientApps/`, `objects/*/…` platform events, `remoteSiteSettings/` |

Standing instructions for every wave-1 agent:

- Implement the recorded solution shape. Do not escalate a requirement up the ladder (configuration to Apex,
  base component to custom component) without saying so and getting the shape amended first.
- Implement against the contract. Do not change a shared signature; message the owning agent through the hub.
- Hold the floor regardless of shape: CRUD/FLS and sharing, bulkification, real error handling, tests for every
  changed behaviour, LWC accessibility, no unreviewed destructive change.
- Write the unit tests that belong to your own artefacts (Apex test class, Jest spec) as part of the build.
- Do not run formatters, linters, `vf-check`, or any deploy. Wave 2 does that.
- Report the files created or changed and anything the contract did not cover.

**Gate 1**: every dispatched agent returned, no two agents touched the same file, and every contract symbol now
exists in source. If two agents did touch one file, reconcile it yourself before wave 2 - do not let both edits
stand unreviewed.

## Wave 2 - check (parallel, one batch)

Dispatch in one batch:

| Agent | Job |
| --- | --- |
| `sf-test-engineer` | Fill test gaps: every new Apex class has a test class, every new LWC has a Jest spec, coverage clears `jestCoverageMin` and `apexClassCoverageMin` |
| `sf-quality-gate` | Run and interpret `vf-check static`; fix analyzer, lint, and format findings inside the changed files |
| `sf-security-reviewer` | CRUD/FLS enforcement, sharing declarations, SOQL/SOSL injection, hardcoded IDs and secrets, exposed `@AuraEnabled` surface |

Then run the local gate yourself:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --changed --json
```

**Gate 2**: exit code `0`. Exit `1` means a gate failed - read the report under `.vibeforce/reports/`, fix the
findings (delegate back to the owning wave-1 agent when the fix is in its slice), and rerun. Exit `2` is a
configuration or tooling problem: report it and stop, because no amount of retrying fixes it. Never pass wave 2
by narrowing the check scope or lowering a gate in `.vibeforce/config.json`.

## Wave 3 - deploy (serial, never parallel)

Resolve the target org from `.vibeforce/config.json` `orgs` - default to the `dev` slot unless the story names
another. Then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-validate --target-org <alias> --json
```

This runs a check-only validation and records the job id in `.vibeforce/state/deploy-jobs.json`. Report the
component count, the test level used, the tests run, and the failures. On success:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-quick --target-org <alias> --json
```

`deploy-quick` reuses the validated job id, so it skips the Apex tests that validation already ran. A validated
job id is valid for 10 days.

If the target alias is listed in `productionAliases`, stop here and hand off to `/vf-deploy <alias>`. This
command never deploys to production.

**Gate 3**: the quick deploy reported success. A failed validation goes back to the owning wave-1 agent with the
component errors attached; do not retry the same payload.

## Wave 4 - verify (parallel, one batch)

Dispatch in one batch:

| Agent | Job |
| --- | --- |
| `sf-org-verifier` | `vf-check smoke`: anonymous Apex probes, `sf data query` assertions, org limits, deploy report |
| `sf-test-engineer` | Apex tests in the org: `vf-check apex --target-org <alias>`, coverage against `apexOrgCoverageMin` and `apexClassCoverageMin` |

**Gate 4**: both returned pass. A post-deploy failure is a forward-fix decision, not a silent pass - hand the
detail to `/vf-verify <alias>` and state whether a rollback is warranted.

## Abort conditions

Stop and report instead of continuing when any of these is true:

| Condition | Why |
| --- | --- |
| Wave 0 cannot fix a cross-slice signature | Wave 1 would invent incompatible APIs |
| `.vibeforce/config.json` is missing | The project was never initialised; run `/vf-init` |
| `vf-check` exits `2` | Missing tool or bad configuration; retrying cannot fix it |
| `vf-check` exits `3` twice on the same check | Org or network failure, not a code problem |
| The story requires a production alias | Production goes through `/vf-deploy` with explicit confirmation |
| Two wave-1 agents edited the same file and their intents conflict | Ownership was wrong; re-cut the slices |
| A gate is failing and the only remaining "fix" is to weaken the gate | The gate is the product |
| A requirement has no recorded ladder rung | Wave 1 would decide the solution shape on its own |
| Meeting the story needs a floor item traded away (CRUD/FLS, bulkification, tests, accessibility, data safety) | The floor is not negotiable; the requirement is wrong |

## Final report

One table of waves with status and duration, the ladder rung chosen per requirement, the files changed per
slice, the gate results with exit codes, the deploy job id, and the post-deploy verdict. Name every deviation
from the contract explicitly, and every requirement that ended higher up the ladder than wave 0.5 decided.
