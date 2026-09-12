---
description: Post-deploy verification against a real Salesforce org - run the verify gate, query org health and async job failures, collect diagnostics, and issue a verdict with a forward-fix or rollback recommendation.
argument-hint: "[target-org] [--tests <ClassName,ClassName.method>]"
allowed-tools: Read, Grep, Glob, Bash(node:*), Bash(sf apex:*), Bash(sf data query:*), Bash(sf org list limits:*), Bash(sf org display:*), Bash(sf project deploy report:*), Task
---

# vf-verify - prove the deploy actually works in the org

Raw arguments: `$ARGUMENTS`

`ALIAS` = the first bare token, or the `dev` entry in `<project>/.vibeforce/config.json` `orgs`.
`TESTS` = the value of `--tests` when given; it switches the Apex run to `RunSpecifiedTests`.
Always pass `--target-org <ALIAS>` explicitly.

Read-only by default. Never deploy, never edit metadata, never modify org data from this command.

## 1. Anchor the deploy under test

```bash
sf org display --target-org <ALIAS> --json
sf project deploy report --use-most-recent --target-org <ALIAS>
```

Record the org username, instance URL, sandbox flag, and the deploy job id, status, and completion time. Read
`<project>/.vibeforce/state/deploy-jobs.json` and confirm the org's most recent deploy is the job this project
validated. If they disagree, say so - you are verifying something other than what was just deployed.

## 2. Run the verify gate

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" verify --target-org <ALIAS> --json
```

Add `--tests <TESTS>` when the user supplied them. `verify` is `apex` plus `smoke`: Apex tests with the coverage
gates, then the post-deploy probes (anonymous Apex, `sf data query` assertions, org limits, deploy report).

Exit codes: `0` pass, `1` a gate failed, `2` misconfiguration, `3` org or network error. On `2`, stop and report
the prerequisite. On `3`, retry once only for a timeout or 5xx, never for an auth failure.

Read the report at `<project>/.vibeforce/reports/verify-<ISO>.json` for `gates` and `findings[]`.

## 3. Org health queries

Run these directly and treat each as a verdict row.

Async Apex failures since the deploy - a deploy that compiles can still break every queued job:

```bash
sf data query --target-org <ALIAS> --result-format json --query "SELECT Id, ApexClass.Name, JobType, Status, NumberOfErrors, ExtendedStatus, JobItemsProcessed, TotalJobItems, CompletedDate FROM AsyncApexJob WHERE Status IN ('Failed','Aborted') AND CreatedDate = LAST_N_DAYS:1 ORDER BY CompletedDate DESC"
```

`NumberOfErrors` is the failure count and `ExtendedStatus` carries the first error message, truncated to 255
characters - it is a pointer to the real error, not the whole story. `JobType` distinguishes `BatchApex`,
`BatchApexWorker`, `Queueable`, `Future`, `ScheduledApex`, and `SharingRecalculation`.

Org limits, to catch a deploy that pushed a governor consumption over the edge:

```bash
sf org list limits --target-org <ALIAS> --json
```

Report `DailyApiRequests`, `DailyAsyncApexExecutions`, `DailyBulkApiBatches`, and `DataStorageMB` as
`remaining / max`, and flag anything under 20% remaining. Report any limit name the org returns that the plugin
does not know about rather than dropping it.

Record counts for the objects the story touched:

```bash
sf org list sobject record-counts --sobject <Object> --target-org <ALIAS>
```

Add story-specific assertions with `sf data query` - the rows the change was supposed to create, update, or stop
creating. Write each one as an expectation with an expected and an actual value, not as a raw dump.

## 4. Diagnostics for anything that failed

Only for failing rows, and only as much as the failure needs:

| Symptom | Diagnostic |
| --- | --- |
| Apex test failure | Failure message and stack trace from the verify report; then `sf apex get log --number 5 --target-org <ALIAS>` |
| Async job failure | `ExtendedStatus`, then the matching `ApexClass.Name` in source |
| Runtime error with no test coverage | `sf apex tail log --target-org <ALIAS> --color` while reproducing, then stop the tail |
| Deploy partially applied | `sf project deploy report --job-id <id> --target-org <ALIAS>`, then the component errors in its JSON output |
| Data assertion mismatch | Re-run the query with the filtering fields selected, and check FLS on the running user |

For anything deeper than this, delegate to `sf-org-verifier` with the failing rows attached instead of expanding
the investigation here.

## 5. Verdict

| Check | Expected | Actual | Verdict |
| --- | --- | --- | --- |
| Deploy job | Succeeded | | PASS / FAIL |
| Apex tests | 0 failures | | |
| Org coverage | >= `apexOrgCoverageMin` | | |
| Class coverage | >= `apexClassCoverageMin` | | |
| Smoke probes | all pass | | |
| Async jobs | 0 failed in the last day | | |
| Org limits | > 20% remaining | | |
| Story assertions | one row each | | |

Overall verdict is the worst row. There is no "mostly passed".

## 6. Recommendation

| Situation | Recommendation |
| --- | --- |
| All rows pass | Ship it. Name the next environment in the `orgs` ladder |
| Test or probe failure, cause known, fix is small and local | Forward fix: name the file, the change, and the gate that will prove it |
| Failure in a component the deploy did not touch | Investigate before either fix - the deploy may have exposed a pre-existing defect |
| Data already written incorrectly | Forward fix plus a data correction plan; state the record count affected |
| Production is broken and the fix is not understood | Roll back: redeploy the last known-good source, then debug off the critical path |

State plainly which one you are recommending and what evidence drives it. When recommending a rollback, name the
job id or commit of the last known-good state; if you cannot identify it, say that first, because it changes the
recommendation.
