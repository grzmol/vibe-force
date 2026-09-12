# Deploy Command Reference

Complete flag surface for the `sf project deploy *` family plus the retrieve and tracking
commands that pair with them. Verified against the Salesforce CLI command reference
(<https://github.com/salesforcecli/cli/blob/main/README.md>) and the plugin message files
(<https://github.com/salesforcecli/plugin-deploy-retrieve/tree/main/messages>).

Every example passes `--target-org` explicitly. Short flags are given because scripts in the wild
use them, but authored scripts in this repo use long flags.

## `sf project deploy start`

Alias: `sf deploy metadata`. Must be run from inside a Salesforce DX project.

```
sf project deploy start -o <value> [--json] [-a <value>] [--async | -w <minutes>]
  [--concise | --verbose] [--dry-run] [-c] [-r] [-g] [--single-package]
  [-t <value>...] [-l NoTestRun|RunSpecifiedTests|RunLocalTests|RunAllTestsInOrg|RunRelevantTests]
  [--purge-on-delete] [--pre-destructive-changes <value>
  [-x <value> | -d <value>... | -m <value>... | --metadata-dir <value>]]
  [--post-destructive-changes <value>]
  [--coverage-formatters clover|cobertura|html-spa|html|json|json-summary|lcovonly|none|teamcity|text|text-summary...]
  [--junit] [--results-dir <value>]
```

### General flags

| Flag | Short | Type | Notes |
| --- | --- | --- | --- |
| `--target-org` | `-o` | string | **Required** unless the `target-org` config variable is set |
| `--api-version` | `-a` | string | Overrides the default (latest supported by the CLI) with your `package.xml` version |
| `--wait` | `-w` | minutes | On expiry the CLI returns the job id; resume with `project deploy resume`, check with `project deploy report` |
| `--async` | | boolean | Returns job id immediately |
| `--concise` | | boolean | Suppresses the per-component success list |
| `--verbose` | | boolean | Full result detail. Mutually exclusive with `--concise` |
| `--dry-run` | | boolean | Validate and run Apex tests but do not save to the org |
| `--ignore-conflicts` | `-c` | boolean | Deploy local files even when they overwrite org changes. Applies only to source-tracked orgs |
| `--ignore-errors` | `-r` | boolean | Do not roll back. **Never use against production** — components with errors are skipped, leaving an inconsistent org |
| `--ignore-warnings` | `-g` | boolean | A warning no longer fails the deploy. Intended for destructive changes in CI where deleting a non-existent component warns |
| `--json` | | boolean | Machine-readable result |

### Payload selection (mutually exclusive)

| Flag | Short | Notes |
| --- | --- | --- |
| `--source-dir` | `-d` | File or folder; folders recurse into all metadata types. Repeat the flag or space-separate values |
| `--metadata` | `-m` | `Type`, `Type:Name`, or `'Type:Name*'` (quote wildcards). Quote names with spaces: `"Profile:My Profile"` |
| `--manifest` | `-x` | Path to `package.xml`. All child components are included automatically |
| `--metadata-dir` | | Root directory or ZIP of **metadata-format** files |
| `--single-package` | | States that the metadata ZIP holds a single-package directory structure |

Deploying a custom object via `--source-dir` or `--metadata CustomObject` also deploys its
associated list views, layouts, and similar child metadata.

### Test flags

| Flag | Short | Notes |
| --- | --- | --- |
| `--test-level` | `-l` | `NoTestRun`, `RunSpecifiedTests`, `RunLocalTests`, `RunAllTestsInOrg`, `RunRelevantTests` (Beta) |
| `--tests` | `-t` | Required with `RunSpecifiedTests`. Space-separated or repeated; **not** comma-separated |
| `--coverage-formatters` | | `clover`, `cobertura`, `html-spa`, `html`, `json`, `json-summary`, `lcovonly`, `none`, `teamcity`, `text`, `text-summary`. Repeat the flag per formatter |
| `--junit` | | Emit JUnit XML |
| `--results-dir` | | Output directory for coverage and JUnit; defaults to the deploy id |

### Destructive-change flags

| Flag | Notes |
| --- | --- |
| `--pre-destructive-changes` | Path to `destructiveChangesPre.xml`; deletions run **before** additions |
| `--post-destructive-changes` | Path to `destructiveChangesPost.xml`; deletions run **after** additions |
| `--purge-on-delete` | Deleted components bypass the Recycle Bin and are immediately eligible for deletion |

Both destructive flags require `--manifest` (a `package.xml` must accompany them) or
`--metadata-dir`.

### Examples

```bash
# Source-tracked delta deploy (only local changes not in the org)
sf project deploy start --target-org vf-dev

# Directory-scoped, concise
sf project deploy start --source-dir force-app --target-org vf-dev --concise

# Type-scoped with coverage artifacts
sf project deploy start --metadata ApexClass ApexTrigger --target-org vf-int \
  --test-level RunLocalTests --coverage-formatters json --coverage-formatters lcovonly \
  --results-dir .vibeforce/reports/coverage --junit --wait 60

# Namespaced components need quoting
sf project deploy start --metadata 'CustomObject:SBQQ__*' --target-org vf-int

# Metadata-format ZIP with destructive manifests inside the directory
sf project deploy start --metadata-dir MDAPI --purge-on-delete --target-org vf-int

# Specified tests only
sf project deploy start --source-dir force-app/main/default/classes --target-org vf-int \
  --test-level RunSpecifiedTests --tests AccountServiceTest ContactServiceTest --wait 60
```

## `sf project deploy validate`

Alias: `sf deploy metadata validate`. Verifies a deployment **without executing it** and returns
a job id for a later quick deploy.

```
sf project deploy validate -o <value> [--json] [-a <value>] [--async] [--concise | --verbose]
  [-m <value>...] [-d <value>...] [--single-package --metadata-dir <value>] [-t <value>...]
  [-l RunAllTestsInOrg|RunLocalTests|RunSpecifiedTests|RunRelevantTests] [-w <minutes>] [-g]
  [--coverage-formatters ...] [--junit] [--results-dir <value>]
  [--purge-on-delete -x <value>] [--pre-destructive-changes <value>]
  [--post-destructive-changes <value>]
```

Differences from `deploy start` that matter:

| Aspect | `deploy start` | `deploy validate` |
| --- | --- | --- |
| Saves to the org | yes (unless `--dry-run`) | never |
| Apex tests | optional | **required** |
| `--test-level` default | depends on payload and org | `RunLocalTests` |
| `NoTestRun` accepted | yes (development orgs) | **no** — not in the option list |
| `--ignore-conflicts` | yes | no such flag (does not support source tracking) |
| `--ignore-errors` | yes | no such flag |
| `--dry-run` | yes | n/a, the command *is* the validation |
| Returns | deploy result | job id valid for 10 days |
| Supported target | any org | production (documented: do not use on sandboxes) |

Errors specific to this command:

- `You must specify tests using the --tests flag if the --test-level flag is set to RunSpecifiedTests.`
- `Failed to validate the deployment (<id>). Due To: ...`
- On success it prints `Run "sf project deploy quick --job-id <id>" to execute this deploy`.

```bash
sf project deploy validate --source-dir force-app --target-org vf-prod \
  --test-level RunLocalTests --coverage-formatters json --results-dir .vibeforce/reports/coverage \
  --wait 180 --verbose

sf project deploy validate --manifest manifest/package.xml --target-org vf-prod \
  --post-destructive-changes manifest/destructiveChangesPost.xml --purge-on-delete \
  --ignore-warnings --test-level RunLocalTests --async
```

## `sf project deploy quick`

```
sf project deploy quick [--json] [--async | -w <minutes>] [--concise | --verbose]
  [-i <value>] [-o <value>] [-r] [-a <value>]
```

| Flag | Short | Notes |
| --- | --- | --- |
| `--job-id` | `-i` | Job id of the validated deployment. Valid for 10 days from the validation |
| `--use-most-recent` | `-r` | Uses the most recently validated deployment — but only searches the **past 3 days** |
| `--target-org` | `-o` | Optional; the cached job already references its org. Required when running from a different machine |
| `--wait` | `-w` | Default **33 minutes** |
| `--async` | | Return immediately |
| `--api-version` | `-a` | Override API version |

Quick deploy skips Apex tests because they already ran during validation. It does not support
source tracking: the deployed source overwrites the org without merging.

Failure message to recognise:
`Job ID can't be used for quick deployment. Possible reasons include the deployment hasn't been
validated, has already been deployed, or the validation expired because you ran it more than 10
days ago.`

```bash
sf project deploy quick --job-id 0Af0x000017yLUFCA2 --target-org vf-prod --wait 60 --verbose
sf project deploy quick --use-most-recent --target-org vf-prod --async
```

## `sf project deploy report`

```
sf project deploy report [--json] [-o <value>] [-i <value>] [-r]
  [--coverage-formatters ...] [--junit] [--results-dir <value>] [-w <minutes>]
```

Checks or polls the status of standard deploys, quick deploys, validations, and cancellations.
Without `--wait` it reports once; with `--wait` it polls every second up to the timeout. It does
**not** update source tracking. Job ids come from `deploy start`, `deploy validate`,
`deploy quick`, and `deploy cancel` when those time out or run `--async`.

```bash
sf project deploy report --job-id 0Af0x000017yLUFCA2 --target-org vf-prod --wait 30
sf project deploy report --use-most-recent --coverage-formatters json-summary --results-dir .vibeforce/reports/coverage
```

## `sf project deploy resume`

```
sf project deploy resume [--json] [--concise | --verbose] [-i <value>] [-r] [-w <minutes>]
  [--coverage-formatters ...] [--junit] [--results-dir <value>]
```

Resumes watching a deploy operation **and updates source tracking when it completes** — the
difference that matters versus `deploy report`.

## `sf project deploy cancel`

```
sf project deploy cancel [--json] [-o <value>] [--async | -w <minutes>] [-i <value>] [-r]
```

Cancels an in-flight deploy or validation. The cancellation itself is asynchronous and produces a
job id you can poll with `deploy report`.

## `sf project deploy preview`

```
sf project deploy preview -o <value> [--json] [-c] [-x <value> | -d <value>... | -m <value>...] [--concise]
```

| Flag | Short | Notes |
| --- | --- | --- |
| `--ignore-conflicts` | `-c` | Suppress the conflict section of the preview |
| `--concise` | | Show only what will deploy; omit force-ignored files |

Output lists components to deploy, components to delete, current conflicts between local project
and org, and files excluded by `.forceignore`. Conflicts appear only for orgs that allow source
tracking.

## Retrieve side (for drift and backups)

```
sf project retrieve start -o <value> [-a <value>] [-c] [-x <value>] [-m <value>...]
  [-n <value>...] [-d <value>...] [-w <minutes>] [--single-package]
  [--target-metadata-dir <value>] [--unzip] [--zip-file-name <value>] [--output-dir <value>]
  [--root-type-with-dependencies <value>]
```

There is **no `--dry-run` flag on `sf project retrieve start`**. Use `sf project retrieve preview`
for a non-destructive look at incoming changes.

| Flag | Short | Notes |
| --- | --- | --- |
| `--ignore-conflicts` | `-c` | Overwrite local files that conflict |
| `--manifest` | `-x` | `package.xml` describing what to retrieve |
| `--metadata` | `-m` | Type/name selection |
| `--package-name` | `-n` | Retrieve an installed package's contents |
| `--target-metadata-dir` | | Write a metadata-format ZIP here instead of converting to source |
| `--zip-file-name` / `--unzip` | | Control the produced archive |
| `--output-dir` | | Retrieve into a directory outside the package directories |
| `--root-type-with-dependencies` | | Retrieve a type plus everything it depends on |

```bash
# Pre-deploy backup of exactly what the release touches
sf project retrieve start --manifest manifest/package.xml --target-org vf-prod \
  --target-metadata-dir .vibeforce/reports/prod-backup --zip-file-name pre-release.zip --wait 60
```

## Manifest generation

```bash
# Manifest for everything in the package directories
sf project generate manifest --source-dir force-app --name package --output-dir manifest

# Manifest from a type list
sf project generate manifest --metadata ApexClass ApexTrigger CustomObject --name package --output-dir manifest

# Manifest of only what changed against main (delta release)
sf project generate manifest --source-dir "$(git diff --name-only origin/main...HEAD -- force-app | tr '\n' ' ')" \
  --name package --output-dir manifest
```

`sf project list ignored --source-dir force-app` shows what `.forceignore` is excluding — run it
whenever a component "won't deploy" for no visible reason. See skill `sf-project-structure`.

## Source tracking commands

| Command | Effect |
| --- | --- |
| `sf org enable tracking --target-org <o>` | Allow CLI source tracking for the org |
| `sf org disable tracking --target-org <o>` | Stop tracking |
| `sf project deploy preview --target-org <o>` | Local -> org preview with conflicts |
| `sf project retrieve preview --target-org <o>` | Org -> local preview with conflicts |
| `sf project reset tracking --target-org <o> [--revision <n>] [--no-prompt]` | Destructive: deletes/overwrites all tracking files. After this, previews report nothing even if conflicts exist |
| `sf project delete tracking --target-org <o> [--no-prompt]` | Deletes only local tracking files |

`--revision` rewinds to a `SourceMember.RevisionCounter`:

```bash
sf data query --use-tooling-api --target-org vf-dev \
  --query "SELECT MemberName, MemberType, RevisionCounter FROM SourceMember ORDER BY RevisionCounter DESC LIMIT 20"
sf project reset tracking --revision 30 --target-org vf-dev --no-prompt
```

## Exit codes and status values

| Status | Process exit code |
| --- | --- |
| `Succeeded` | 0 |
| `Canceled` | 1 |
| `Failed` | 1 |
| `SucceededPartial` | 68 |
| `InProgress` | 69 |
| `Pending` | 69 |
| `Canceling` | 69 |

`SucceededPartial` only occurs with `--ignore-errors`, which is why that flag is banned for
production in this harness: exit code 68 is a success-shaped failure.

vibe-force `vf-check` normalises these: `0` pass, `1` gate failed, `2` misconfiguration/missing
tool, `3` org or network error. A `SucceededPartial` from the CLI becomes a `vf-check` exit `1`.

## Configuration variables and environment

| Name | Effect |
| --- | --- |
| `target-org` | Default org for all commands (`sf config set target-org=vf-dev`) |
| `target-dev-hub` | Default Dev Hub |
| `org-api-version` | API version of the project; defaults to the Dev Hub's |
| `SF_TARGET_ORG` | Overrides the `target-org` config variable |
| `SF_USE_PROGRESS_BAR` | `false` disables the deploy progress bar — set this in CI |
| `SF_LOG_LEVEL` | `debug` for CLI diagnostics (skill `sf-debugging-logs`) |

vibe-force environment overrides, orthogonal to the CLI's own: `VF_HOOK_MODE`
(`off|minimal|standard|strict`), `VF_ALLOW_PROD=1`, `VF_SKIP_CHECKS=1`, `VF_DEBUG=1`.

## `--json` shapes worth scripting against

```bash
# Deploy id from a validation
sf project deploy validate --source-dir force-app --target-org vf-prod \
  --test-level RunLocalTests --async --json | jq -r '.result.id'

# Component failures, one per line
sf project deploy report --job-id "$JOB" --target-org vf-prod --json \
  | jq -r '.result.details.componentFailures[]? | "\(.componentType) \(.fullName): \(.problem)"'

# Test failures
sf project deploy report --job-id "$JOB" --target-org vf-prod --json \
  | jq -r '.result.details.runTestResult.failures[]? | "\(.name).\(.methodName): \(.message)"'

# Org-wide coverage warning
sf project deploy report --job-id "$JOB" --target-org vf-prod --json \
  | jq -r '.result.details.runTestResult.codeCoverageWarnings[]?.message'
```

`vf-check deploy-validate` and `deploy-quick` persist these into
`<project>/.vibeforce/reports/<check>-<ISO>.json` under `findings[]` and `raw`.
