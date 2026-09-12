# Failure handling and rollback

Salesforce has no native deploy rollback. Once metadata is committed to an org, the only ways
back are a forward fix, a destructive change, or a re-deploy of the previous source. That
asymmetry drives every rule below.

## Abort conditions per wave

| Wave | Abort when | Action |
| --- | --- | --- |
| 0 | scout finds the story touches a shared file no split can separate | stop, re-scope, serialise that file under one owner |
| 0 | baseline `vf-check static --changed` already fails | fix the baseline first; never start a story on a failing tree |
| 1 | two agents request the same path | pause the wave, orchestrator re-splits ownership or serialises the edit |
| 1 | a contract turns out to be wrong | pause the wave, amend `contract.md`, re-brief; do not let agents improvise |
| 1 | an agent reports the requirement needs a rung it was not given (for example: config cannot do it, Apex is needed) | orchestrator decides, updates the contract, then resumes |
| 2 | gate finding at or above `analyzerFailSeverity`, failing test, or coverage below gate | route to the owning agent, re-run the gate; no threshold changes |
| 2 | security reviewer finds a missing CRUD/FLS, sharing, or secret issue | mandatory fix, no exceptions, re-review |
| 3 | `deploy-validate` fails | do not touch the org further; fix in wave 1, re-validate |
| 3 | validation passes but the component set is wrong (missing or unexpected components) | fix the manifest or `.forceignore`, re-validate |
| 4 | smoke probe fails, org test fails, or an acceptance criterion is unmet | decide forward fix versus rollback (below) |
| any | a guard hook denies an operation | treat the reason as the specification; do not work around the guard |

## Deploy failure triage

```bash
# what actually failed
sf project deploy report --job-id <id> --target-org <alias> --json | jq '.result.details.componentFailures[] | {fullName, componentType, problem}'

# test failures from the validation run
sf project deploy report --job-id <id> --target-org <alias> --json | jq '.result.details.runTestResult.failures[] | {name, methodName, message}'

# coverage shortfalls
sf project deploy report --job-id <id> --target-org <alias> --json | jq '.result.details.runTestResult.codeCoverageWarnings'
```

| Failure class | Typical cause | Route to |
| --- | --- | --- |
| Component compile error | Apex referencing a field or class not in the deploy set | `sf-apex-engineer` + manifest review |
| Missing dependency | metadata referenced but excluded by `.forceignore` or not committed | `sf-metadata-engineer` |
| Test failure only in the org | org data, sharing, or automation the local tests never see | `sf-test-engineer` (make the test org-independent) |
| Coverage warning | new class without a test, or a test that does not exercise it | `sf-test-engineer` |
| `INVALID_CROSS_REFERENCE_KEY`, picklist value errors | value sets, record types, or dependent picklists out of sync | `sf-metadata-engineer` |
| Flow activation error | active version conflict or missing referenced element | `sf-metadata-engineer` |
| Permission errors post-deploy | permission set not deployed or not assigned | `sf-metadata-engineer` + wave 4 recheck |

## Forward fix versus rollback

Decide with the blast radius, not with the embarrassment.

| Condition | Decision |
| --- | --- |
| Defect is cosmetic or affects one non-critical screen | forward fix, next wave 1 |
| Defect blocks a business process but data is intact | forward fix with priority; consider disabling the entry point (permission set, flow deactivation, feature toggle) as an immediate mitigation |
| Defect writes wrong data | stop the writer first (toggle, deactivate flow, remove permission), then forward fix, then remediate data |
| Defect is in a sandbox | forward fix; sandboxes exist for this |
| New metadata must be removed entirely | destructive change through validate + quick deploy, with the component list reviewed by a human |
| Previous release must come back | re-deploy the previous git tag's source, not an ad hoc subset |

Immediate mitigations that need no deploy, in order of preference:

1. Remove the permission set assignment that exposes the feature.
2. Deactivate the record-triggered flow (a flow version change is a deploy, but a
   *deactivation* through Setup is immediate; record it and reconcile the source afterwards).
3. Flip the feature toggle (custom permission or custom metadata row) the story shipped with.
4. Abort the running async jobs: `System.abortJob` for the ids from `AsyncApexJob`.

Each of those is a reason to ship a toggle with anything risky in the first place.

## Rolling back source

```bash
# the previous released state, as source
git checkout <previous-release-tag> -- force-app

# validate the rollback like any other deploy
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-validate --target-org <alias>
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-quick   --target-org <alias>
```

What a source rollback does **not** undo:

- data written by the defective code (needs a data remediation plan)
- deleted fields or objects (data is gone; restoring the field does not restore values)
- picklist values removed from a value set (records keep the value but it is inactive)
- external systems already called (needs a compensating call or a replay)
- platform events already published and consumed
- flow interviews already paused mid-orchestration

Before any destructive deploy, retrieve the current state so a rollback is possible at all:

```bash
sf project retrieve start --manifest manifest/package.xml --target-org <alias> --output-dir .vibeforce/reports/pre-deploy-snapshot
```

## Post-mortem inputs

Everything needed is already on disk:

```bash
jq -s '.' .vibeforce/state/events.jsonl | jq '[.[] | select(.decision)] | group_by(.rule) | map({rule: .[0].rule, count: length})'
ls -1t .vibeforce/reports | head -20
jq '.jobs[-3:]' .vibeforce/state/deploy-jobs.json
cat .vibeforce/state/session-notes.md
```

Write the post-mortem against the wave that should have caught the defect, and change that gate:

| Escaped through | Gate to strengthen |
| --- | --- |
| Logic defect | wave 2 test, usually a missing bulk or negative case |
| Permission defect | wave 4 verification query for permission set assignment |
| Data-shape defect | wave 4 verification query, and a seeded scratch org in wave 2 |
| Integration defect | contract test with a mocked endpoint, plus a sandbox smoke probe |
| Scope creep | wave 0 contract, "out of scope" section |
| Over-build | `/vf-review` over-build pass |

A defect that escaped is a gate that was not there. Adding a test to the suite is the smaller
half of the fix; the larger half is which gate now runs it.
