# Deployment Error Catalogue

Error string -> cause -> fix. Grouped by where the failure surfaces. Strings quoted verbatim from
the CLI plugin messages
(<https://github.com/salesforcecli/plugin-deploy-retrieve/tree/main/messages>) or from Metadata
API behaviour documented in the Metadata API Developer Guide are marked as such; strings that are
paraphrases of platform errors are marked `(paraphrase)` because their exact wording varies by
release and org.

## Status values and exit codes

| Deploy status | CLI exit code | Meaning |
| --- | --- | --- |
| `Succeeded` | 0 | The deploy succeeded |
| `Canceled` | 1 | The deploy was canceled |
| `Failed` | 1 | The deploy failed and rolled back |
| `SucceededPartial` | 68 | Partially succeeded — only possible with `--ignore-errors` |
| `InProgress` | 69 | Still running |
| `Pending` | 69 | Queued |
| `Canceling` | 69 | Cancellation in flight |

`vf-check` normalises these to `0` pass, `1` gate failed, `2` misconfiguration, `3` org/network
error. `SucceededPartial` is reported as a `vf-check` failure (`1`), never as a pass.

## CLI-level failures (before the org is touched)

| Message | Cause | Fix |
| --- | --- | --- |
| `This command is required to run from within a Salesforce project` | `sfdx-project.json` not found in the working directory or an ancestor | `cd` into the project root; see skill `sf-project-structure` |
| `No target org found in cache, from a flag, or in the environment.` (verbatim, `deploy quick`) | No `--target-org` and no `target-org` config variable | Pass `--target-org`, or `sf config set target-org=<alias>` |
| `No default dev hub found` | Scratch-org command without `--target-dev-hub` | `sf config set target-dev-hub=vf-devhub --global` |
| `You must specify tests using the --tests flag if the --test-level flag is set to RunSpecifiedTests.` (verbatim) | `RunSpecifiedTests` with no `--tests` | Supply space-separated or repeated `--tests` values |
| `No local changes to deploy.` (verbatim) | Source-tracked delta deploy with nothing pending | Expected; not an error. Use `--source-dir`/`--manifest` to force a full deploy |
| Flags `--source-dir`, `--metadata`, `--manifest` combined | Mutually exclusive payload selectors | Pick one |
| `--concise` with `--verbose` | Mutually exclusive | Pick one |
| Unexpected empty payload with `--source-dir` | Components excluded by `.forceignore` | `sf project list ignored --source-dir force-app` |
| `--test-level NoTestRun` rejected by `deploy validate` | `NoTestRun` is not in the validate option list | Use `RunLocalTests`, or `deploy start --dry-run` on a sandbox |
| Comma-separated `--tests` silently runs nothing useful | The CLI changed to space-separated values and warns about it | `--tests A B "C D"` or repeat `--tests` |

## Authentication and connectivity

| Message | Cause | Fix |
| --- | --- | --- |
| `Error authenticating with the refresh token due to: expired access/refresh token` (verbatim) | Org auth expired, or the scratch org/trial expired | `sf org logout --target-org <alias>` then re-authenticate |
| `Error authenticating with the refresh token due to: inactive user` (verbatim) | Integration user deactivated | Reactivate or repoint to a live integration user |
| `INVALID_LOGIN` / `invalid_grant` `(paraphrase)` | JWT flow misconfiguration: wrong consumer key, certificate mismatch, user not pre-authorized for the connected app, wrong `--instance-url` | Verify all four; sandboxes need `https://test.salesforce.com` |
| `Session expired or invalid` `(paraphrase)` | Long deploy outlived the session, or IP restrictions | Re-authenticate; relax IP restrictions for the integration user's profile |
| `Cannot reach the org` / socket timeouts | Network, proxy, or a Salesforce incident | `sf org display --target-org <alias>`; check <https://status.salesforce.com>. `vf-check` reports exit `3` |
| `REQUEST_LIMIT_EXCEEDED` `(paraphrase)` | Org API request limit hit | `sf limits api display --target-org <alias>`; reduce polling, raise `--poll-interval` |

## Validation and quick-deploy failures

| Message | Cause | Fix |
| --- | --- | --- |
| `Failed to validate the deployment (<id>). Due To: ...` (verbatim) | Component or test failures during validation | `sf project deploy report --job-id <id> --verbose`; nothing was saved to the org |
| `Job ID can't be used for quick deployment. Possible reasons include the deployment hasn't been validated, has already been deployed, or the validation expired because you ran it more than 10 days ago.` (verbatim) | One of the three named conditions | `sf project deploy report --job-id <id>` to see which; re-validate if expired, check `consumedBy` in `deploy-jobs.json` if already deployed |
| `Deployment <id> exited with status code: <status>` (verbatim) | Quick deploy failed in the org | `sf project deploy report --job-id <id> --verbose` for component failures |
| `deploy quick --use-most-recent` finds no job | The flag only searches validations from the past 3 days | Pass `--job-id` from `.vibeforce/state/deploy-jobs.json` |
| Quick deploy rejected although the validation passed | Coverage requirements were not met, so the validation is not quick-deployable | Overall 75% (org-wide levels) or 75% per deployed class and trigger (`RunSpecifiedTests`); add tests |
| Validation succeeded on a sandbox but quick deploy refuses | `deploy validate`/`quick` are production commands | Use `deploy start --dry-run` on sandboxes; `vf-check deploy-validate` records those as `kind: "dry-run"` and will not quick-deploy them |

## Test and coverage failures

| Message | Cause | Fix |
| --- | --- | --- |
| `Average test coverage across all Apex Classes and Triggers is <n>%, at least 75% test coverage is required` `(paraphrase)` | Org-wide coverage below the platform floor with `RunLocalTests`/`RunAllTestsInOrg` | Add tests for the lowest-covered classes; `sf apex run test --code-coverage --result-format human` |
| `Apex trigger <name> has 0% code coverage` `(paraphrase)` | Triggers must have some coverage | Add a trigger test; skill `sf-apex-testing` |
| Per-class coverage failure under `RunSpecifiedTests` | Each deployed class and trigger needs 75% individually under this level | Either widen `--tests` or switch to `RunLocalTests` |
| `System.AssertException` in a deploy test run | Genuine regression, or a test depending on org data | Fix the code; remove `SeeAllData=true` dependencies |
| `UNABLE_TO_LOCK_ROW` in tests during deploy | Parallel test execution contending on the same records | Disable parallel testing for the class, or isolate the fixture |
| Tests pass locally, fail during deploy | Deploy runs the whole org's tests, not just yours | Run `sf apex run test --test-level RunLocalTests --target-org <o>` before validating |
| `MIXED_DML_OPERATION` `(paraphrase)` | Setup and non-setup objects in one transaction | `System.runAs` in the test; skill `sf-apex-testing` |

## Component-level failures

| Message | Cause | Fix |
| --- | --- | --- |
| `Cannot find <Type> <Name>` `(paraphrase)` | Dependency not in the payload and not in the org | Add it to the manifest; manifest-scoped deploys resolve intra-payload dependencies |
| `Dependent class is invalid and needs recompilation` `(paraphrase)` | A class the payload references no longer compiles | Include the dependent class, or fix it first |
| `Cannot delete <component>: in use by <other>` `(paraphrase)` | Deletion blocked by a reference | Deploy the dereferencing change and the deletion together via `--post-destructive-changes` |
| Delete rejected for a component on an active Lightning page | Documented restriction: you cannot use `destructiveChanges.xml` to delete items associated with an active Lightning page | Deactivate the page's action override in Lightning App Builder, then delete |
| `Entity is not org-enabled` `(paraphrase)` | The target org lacks the feature the metadata needs | Enable the feature (scratch orgs: `features`/`settings` in the definition file) |
| `duplicate value found: <field> duplicates value on record` `(paraphrase)` | Unique constraint hit by deployed data-like metadata (custom metadata records, value sets) | De-duplicate the payload |
| `INVALID_CROSS_REFERENCE_KEY` `(paraphrase)` | Referenced record/id does not exist in the target (queue members, users, profiles) | Remove environment-specific references from source |
| Picklist value removal has no effect | Picklist values deploy additively | Explicit destructive change on the value, or manage via `GlobalValueSet` |
| `Required fields are missing: [Welcome Email Template, Change Password Email Template, ...]` (verbatim, org shape context) | Experience Cloud site created from an org shape lacks the email templates | Deploy the templates and the Experience Cloud feature/settings |
| Flow deployed but the wrong version is live | `FlowDefinition.activeVersionNumber` overrides the flow's `status` | Correct `activeVersionNumber`, or omit `flowDefinitions` and control status on the `Flow` |
| Layout deployed but invisible | Layout assignments live in Profiles | Deploy the assigning profile |
| Roll-up summary field gone from the Recycle Bin | Documented: roll-up summary deletions are purged even without `purgeOnDelete` | Nothing to fix; treat as permanent |

## Destructive-change failures

| Message | Cause | Fix |
| --- | --- | --- |
| Nothing deleted, no error | Wildcards are not supported in destructive manifests | List every member explicitly |
| `package.xml` missing alongside a destructive manifest | A `package.xml` is required even for a delete-only deploy | Add one containing only `<version>67.0</version>` |
| Warning about deleting a non-existent component fails the deploy | Warnings are treated as errors unless suppressed | `--ignore-warnings` (the legitimate CI use of that flag) |
| Deletions happening before your additions unexpectedly | Deletions are processed before additions by default | Use `destructiveChangesPost.xml` |
| Deleted component still recoverable when it should not be | Recycle Bin retention | `--purge-on-delete` |
| vibe-force hook refuses the command | `hooks.blockDestructive` is `true` and the command carries a destructive flag | Obtain approval for the destructive plan; the hook reports the exact flag it matched |

## Source-tracking and conflict failures

| Message | Cause | Fix |
| --- | --- | --- |
| `Conflicts [n]. Run the command with the --ignore-conflicts flag to override.` (verbatim, from `deploy preview` output) | Local and org both changed the same component | Inspect with `deploy preview`, resolve, then targeted `--ignore-conflicts`; see skill `sf-scratch-orgs-sandboxes` |
| `We couldn't complete the operation due to conflicts.` (verbatim, legacy message) | Same cause, older command surface | Same fix |
| `--ignore-conflicts` has no effect | The org does not allow source tracking (production, Full/Partial sandbox) | Expected; use manifest deploys and git-based drift detection |
| `deploy preview` reports nothing despite known divergence | Tracking was reset | `sf project reset tracking` wipes tracking state; re-establish by deploying/retrieving deliberately |
| Endless profile/layout churn in previews | Whole-file XML types plus ordering differences | Normalise with the project formatter; minimise what profiles carry |

## Timeout and long-running deploys

| Symptom | Cause | Fix |
| --- | --- | --- |
| CLI returns a job id and exits | `--wait` elapsed; the deploy continues server-side | `sf project deploy resume --job-id <id> --wait 60` (updates tracking) or `sf project deploy report --job-id <id> --wait 60` (does not) |
| CI job cancelled mid-deploy | Runner concurrency cancelled the job | `concurrency.cancel-in-progress: false`; clean up with `sf project deploy cancel --job-id <id>` |
| Deploy stuck in `Pending` | Org-side queue | Poll with `deploy report`; do not start a second deploy to the same org |
| Cancel appears not to work | Cancellation is asynchronous and has its own job id | Poll the cancel job with `deploy report` until `Canceled` |
| Validation far slower than a normal deploy | Validation is required to run Apex tests | Expected; that is the point — the time is spent outside the change window |

## Diagnostic recipes

```bash
# Everything about a job in one call
sf project deploy report --job-id "$JOB" --target-org vf-prod --verbose

# Machine-readable failure triage
sf project deploy report --job-id "$JOB" --target-org vf-prod --json > /tmp/r.json
jq -r '.result.status, .result.numberComponentErrors, .result.numberTestErrors' /tmp/r.json
jq -r '.result.details.componentFailures[]? | "[\(.componentType)] \(.fullName) :: \(.problem)"' /tmp/r.json
jq -r '.result.details.runTestResult.failures[]? | "\(.name).\(.methodName) :: \(.message)"' /tmp/r.json
jq -r '.result.details.runTestResult.codeCoverageWarnings[]?.message' /tmp/r.json

# What is the CLI actually doing
SF_LOG_LEVEL=debug sf project deploy start --source-dir force-app --target-org vf-int --dry-run 2> /tmp/deploy.log

# Is the target org healthy at all
sf org display --target-org vf-prod --verbose
sf limits api display --target-org vf-prod

# Is the payload what I think it is
sf project deploy preview --target-org vf-int --concise
sf project list ignored --source-dir force-app
```

For Apex-side debugging (debug logs, trace flags, `ApexLog` queries) see skill
`sf-debugging-logs`. For interpreting analyzer findings that block the local gate before a deploy
is even attempted, see skill `sf-code-analyzer-quality`.

## Triage order

1. **Did the CLI even talk to the org?** Exit `2`-shaped errors (missing project, bad flags,
   unknown alias) cost nothing to fix and are the most common.
2. **Auth or connectivity?** `sf org display`. `vf-check` exit `3`.
3. **Component failures?** `componentFailures[]`. Almost always a missing dependency or an
   environment-specific reference.
4. **Test failures?** `runTestResult.failures[]`. Reproduce with
   `sf apex run test --test-level RunLocalTests` before touching the payload.
5. **Coverage?** `codeCoverageWarnings[]`. Binding for quick deploy even when the validation
   reports success.
6. **Conflicts?** `deploy preview`. Resolve component by component.
7. **Still stuck?** Narrow the payload until it deploys, then bisect. A manifest with one type is
   a much better bug report than `--source-dir force-app`.
