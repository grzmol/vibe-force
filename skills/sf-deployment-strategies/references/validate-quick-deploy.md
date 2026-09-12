# Validate + Quick Deploy: Production Runbook

The only sanctioned way vibe-force puts metadata into a production org. This reference covers the
mechanics, the state file, hook interaction, the rollback window, and the failure branches.

Sources: `sf project deploy validate` / `sf project deploy quick` command reference
(<https://github.com/salesforcecli/plugin-deploy-retrieve/tree/main/messages>), Metadata API
`deployRecentValidation()`
(<https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_deployRecentValidation.htm>),
and Salesforce DX Developer Guide *Release Your App to Production*
(<https://developer.salesforce.com/docs/atlas.en-us.262.0.sfdx_dev.meta/sfdx_dev/sfdx_dev_build_mdapi_production.htm>).

## Why two steps

A normal production deploy runs Apex tests inside the change window. On a large org that is
hours, and a single test failure at minute 140 wastes the whole window. Validation moves the test
run outside the window: it compiles, deploys nothing, runs the tests, records coverage, and hands
back a job id. The quick deploy then writes the already-validated payload with no test run, which
takes minutes.

## Preconditions for a quick deploy to be accepted

All of these must hold, per the Metadata API documentation for `deployRecentValidation()`:

1. The components were validated successfully **for the target environment** within the last
   **10 days**.
2. The Apex tests in the target org passed as part of that validation.
3. Code coverage requirements were met:
   - with `RunLocalTests` or `RunAllTestsInOrg`: overall org coverage at least **75%**, and Apex
     triggers must have **some** coverage;
   - with `RunSpecifiedTests`: **each** deployed class and trigger individually covered at least
     **75%**.

If any precondition fails, `sf project deploy quick` reports:
`Job ID can't be used for quick deployment. Possible reasons include the deployment hasn't been
validated, has already been deployed, or the validation expired because you ran it more than 10
days ago.`

A validation job is single-use: once quick-deployed it cannot be replayed.

## Step-by-step runbook

### 0. Pre-flight (no org needed)

```bash
git fetch origin --tags
git status --porcelain            # must be empty
node "$VF_ROOT/scripts/checks/vf-check.mjs" local --json
```

`vf-check local` = format + lint + analyzer + jest. Never spend a 3-hour validation on a payload
that fails prettier.

### 1. Freeze the payload

```bash
RELEASE_TAG="release/2026-09-12"
git tag -a "$RELEASE_TAG" -m "vibe-force release"
SHA="$(git rev-parse HEAD)"

# Delta manifest: only what changed since the last release tag
PREV="$(git describe --tags --abbrev=0 "$RELEASE_TAG^" 2>/dev/null || echo origin/main)"
CHANGED="$(git diff --name-only "$PREV...$RELEASE_TAG" -- force-app | tr '\n' ' ')"
sf project generate manifest --source-dir $CHANGED --name package --output-dir manifest
cat manifest/package.xml
```

A manifest-scoped release is materially safer than `--source-dir force-app`: smaller blast
radius, shorter validation, and a destructive plan you can reason about.

### 2. Back up the pre-deploy state

```bash
mkdir -p .vibeforce/reports/backup
sf project retrieve start \
  --manifest manifest/package.xml \
  --target-org vf-prod \
  --target-metadata-dir .vibeforce/reports/backup \
  --zip-file-name "pre-${SHA:0:7}.zip" \
  --wait 60
```

This ZIP is the rollback payload of last resort. Commit it as a CI artifact, not into the repo.

### 3. Pre-validate the rollback (optional but cheap insurance)

```bash
git checkout "$PREV" -- force-app
ROLLBACK_JOB=$(sf project deploy validate --manifest manifest/package.xml --target-org vf-prod \
  --test-level RunLocalTests --async --json | jq -r '.result.id')
git checkout "$RELEASE_TAG" -- force-app
echo "rollback job: $ROLLBACK_JOB (valid 10 days)"
```

Now a bad release can be reverted with a minutes-long quick deploy instead of another full test
run.

### 4. Validate the release

```bash
node "$VF_ROOT/scripts/checks/vf-check.mjs" deploy-validate --target-org vf-prod --json
```

which runs, in effect:

```bash
sf project deploy validate \
  --manifest manifest/package.xml \
  --target-org vf-prod \
  --test-level RunLocalTests \
  --coverage-formatters json --coverage-formatters json-summary \
  --results-dir .vibeforce/reports/coverage \
  --junit \
  --wait 180 \
  --verbose \
  --json
```

If the validation includes deletions:

```bash
sf project deploy validate \
  --manifest manifest/package.xml \
  --post-destructive-changes manifest/destructiveChangesPost.xml \
  --purge-on-delete \
  --ignore-warnings \
  --target-org vf-prod --test-level RunLocalTests --wait 180
```

`--ignore-warnings` here is deliberate: deleting a component that is already absent raises a
warning that would otherwise mark the validation unsuccessful.

Note what `deploy validate` does **not** accept: `--test-level NoTestRun`, `--ignore-conflicts`,
`--ignore-errors`, `--dry-run`. It does not participate in source tracking at all.

### 5. Gate on the validation result

```bash
JOB="$(jq -r '.jobs[-1].jobId' .vibeforce/state/deploy-jobs.json)"
sf project deploy report --job-id "$JOB" --target-org vf-prod --json > /tmp/val.json

jq -r '.result.numberTestErrors, .result.details.runTestResult.numFailures' /tmp/val.json
jq -r '.result.details.runTestResult.codeCoverageWarnings[]?.message' /tmp/val.json
jq -r '.result.details.componentFailures[]? | "\(.componentType) \(.fullName): \(.problem)"' /tmp/val.json
```

`vf-check deploy-validate` applies `gates.apexOrgCoverageMin` (85 by default, stricter than the
platform's 75) and `gates.apexClassCoverageMin` (75) and exits `1` if either is missed. The
platform minimum is the floor, not the target.

### 6. Quick deploy inside the change window

```bash
node "$VF_ROOT/scripts/checks/vf-check.mjs" deploy-quick --target-org vf-prod --json
```

which runs:

```bash
sf project deploy quick --job-id "$JOB" --target-org vf-prod --wait 60 --verbose --json
```

Default `--wait` for quick deploy is 33 minutes. Use `--async` plus `sf project deploy report`
when the window is scripted around other work.

### 7. Verify

```bash
node "$VF_ROOT/scripts/checks/vf-check.mjs" verify --target-org vf-prod --json
sf project deploy report --job-id "$JOB" --target-org vf-prod --verbose
```

`verify` = org Apex tests (`RunSpecifiedTests` when `--tests` is supplied) plus the smoke probes
described in skill `sf-post-deploy-verification`. Deploy success is not release success.

## `.vibeforce/state/deploy-jobs.json` contract

Written by `vf-check deploy-validate`, consumed by `vf-check deploy-quick`. Append-only; newest
last.

```json
{
  "version": 1,
  "jobs": [
    {
      "jobId": "0Af0x000017yLUFCA2",
      "kind": "validate",
      "targetOrg": "vf-prod",
      "targetOrgId": "00D000000000000EAA",
      "testLevel": "RunLocalTests",
      "manifest": "manifest/package.xml",
      "sha": "9f2c1ab3d4e5f60718293a4b5c6d7e8f90a1b2c3",
      "tag": "release/2026-09-12",
      "validatedAt": "2026-09-12T09:14:02.113Z",
      "expiresAt": "2026-09-22T09:14:02.113Z",
      "status": "Succeeded",
      "coverage": { "org": 87.4, "minClass": 78.1 },
      "consumedBy": null
    },
    {
      "jobId": "0Af0x000017yQ11CA2",
      "kind": "validate",
      "targetOrg": "vf-prod",
      "role": "rollback",
      "sha": "1122334455667788990011223344556677889900",
      "tag": "release/2026-08-29",
      "validatedAt": "2026-09-12T09:02:55.004Z",
      "expiresAt": "2026-09-22T09:02:55.004Z",
      "status": "Succeeded",
      "consumedBy": null
    }
  ]
}
```

Selection rules `deploy-quick` implements:

| Condition | Behaviour |
| --- | --- |
| No entry for `targetOrg` | exit `2` with "run deploy-validate first" |
| Newest entry `expiresAt` in the past | exit `2`; the 10-day window elapsed, re-validate |
| Newest entry `status != "Succeeded"` | exit `1`; the validation itself failed |
| Newest entry `consumedBy != null` | exit `2`; that job was already quick-deployed |
| Newest entry `sha` differs from `git rev-parse HEAD` | exit `2` unless `--json` caller passes an explicit `--job-id`; the working tree moved on since validation |
| Otherwise | quick deploy, then set `consumedBy` to the deploy id and append a `kind: "quick"` entry |

`role: "rollback"` entries are never auto-selected; they are addressed explicitly with
`--job-id`. The file is gitignored in the consumer project along with the rest of `.vibeforce/`.

## Hook interaction

The vibe-force hooks (Claude Code lifecycle hooks defined in `hooks/hooks.json`) inspect every
shell command an agent tries to run.

| Config / env | Effect on production deploys |
| --- | --- |
| `hooks.blockProductionDeploy: true` (default) | Any `sf project deploy start`, `deploy quick`, or `vf-check deploy-quick` whose target alias appears in `productionAliases` (`vf-prod`, `prod`, `production`) is refused |
| `VF_ALLOW_PROD=1` | Single-session override; the guard reports the bypass in the hook output |
| `hooks.blockDestructive: true` (default) | Refuses commands carrying `--pre-destructive-changes`, `--post-destructive-changes`, or `--purge-on-delete` |
| `hooks.mode: strict` | Additionally requires a green `vf-check local` report within the session before any org-touching deploy |
| `hooks.mode: minimal` | Production and destructive guards only |
| `hooks.mode: off` / `VF_HOOK_MODE=off` | No guards. Never set this in CI |
| `VF_SKIP_CHECKS=1` | Skips the pre-deploy local gate; does **not** disable the production guard |

`sf project deploy validate` is **not** blocked against production — validating saves nothing, so
the guard deliberately allows it. That is what makes "validate freely, quick-deploy under
approval" the natural shape of the workflow.

Practical consequence for agents: `sf-deploy-engineer` can always run `deploy-validate`. It must
obtain an explicit human approval (surfaced as `VF_ALLOW_PROD=1`) before `deploy-quick`.

## Failure branches

| Branch | Diagnosis | Action |
| --- | --- | --- |
| Validation fails on component errors | `componentFailures[]` in the report | Fix source, re-validate. No org state changed |
| Validation fails on test failures | `runTestResult.failures[]` | Fix the test or the code; skill `sf-apex-testing` |
| Validation passes, coverage warning present | `codeCoverageWarnings[]` | Coverage is a quick-deploy precondition; add tests before promoting |
| Validation times out | CLI returns the job id | `sf project deploy report --job-id <id> --wait 60`; do not re-validate |
| Quick deploy rejected as expired | more than 10 days since validation | Re-validate; the payload must be re-tested |
| Quick deploy rejected as already deployed | job consumed | Check `consumedBy` in the state file; the release may already be live |
| Quick deploy fails mid-flight | partial component failures | `sf project deploy report --job-id <id> --verbose`; the deploy rolls back unless `--ignore-errors` was used (it must not be) |
| Quick deploy succeeds, behaviour wrong | not a deploy problem | Forward-fix, or quick-deploy the pre-validated rollback job |
| `deploy quick --use-most-recent` finds nothing | that flag only searches the past 3 days | Always pass `--job-id` from the state file |

## Sandbox equivalent

Do not use `deploy validate` / `deploy quick` on sandboxes — they are documented as production
commands, and sandboxes do not run tests during a deploy by default. The sandbox-side equivalent
of a validation is:

```bash
sf project deploy start --dry-run --test-level RunLocalTests \
  --source-dir force-app --target-org vf-int --wait 90 \
  --coverage-formatters json --results-dir .vibeforce/reports/coverage
```

This is what `vf-check deploy-validate` runs when the target org is **not** in
`productionAliases`: same gate, same report shape, different underlying command. The check
records `kind: "dry-run"` in `deploy-jobs.json` and `deploy-quick` refuses to consume those
entries, because a dry run produces no deployable job.

## Timing budget

| Phase | Typical duration | Window-critical? |
| --- | --- | --- |
| `vf-check local` | seconds to a few minutes | no |
| Pre-deploy retrieve backup | 1–10 min | no |
| Rollback pre-validation | as long as a validation | no |
| Release validation (`RunLocalTests`, large org) | 30 min – 3 h+ | no |
| Quick deploy | 1–15 min | **yes** |
| `vf-check verify` | 2–20 min | yes |

Everything except the last two rows runs before the change window opens. That is the whole point
of the pattern.

## Checklist

- [ ] Working tree clean, release tagged
- [ ] `vf-check local` green
- [ ] Manifest scoped to the release, reviewed
- [ ] Destructive manifest authored and reviewed (or explicitly none)
- [ ] Pre-deploy backup retrieved and archived
- [ ] Rollback payload pre-validated, job id recorded with `role: "rollback"`
- [ ] Release validated, job id and `expiresAt` in `deploy-jobs.json`
- [ ] Test failures zero; coverage above `gates.apexOrgCoverageMin`
- [ ] Human approval obtained (`VF_ALLOW_PROD=1`) for the quick deploy
- [ ] Quick deploy succeeded; `consumedBy` recorded
- [ ] `vf-check verify` green
- [ ] Post-deploy manual tasks from the release runbook completed
- [ ] Reports archived from `.vibeforce/reports/`
