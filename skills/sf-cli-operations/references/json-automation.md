# `--json` shapes and jq recipes

Every `sf` command that lists `--json` under `GLOBAL FLAGS` prints the same envelope:

```json
{
  "status": 0,
  "result": { },
  "warnings": []
}
```

- `status` is `0` on success and non-zero on failure.
- `result` holds the command payload; its shape is described by the JSON schema in the owning
  plugin's repo (`schemas/<command-with-hyphens>.json`).
- `warnings` is an array of human-readable strings — never parse it for control flow.
- On failure the object additionally carries `name`, `message`, and often `data`/`stack`, and is
  written to **stderr** unless `SF_JSON_TO_STDOUT=true`.
- `--json` overrides `-r/--result-format`. `SF_CONTENT_TYPE=JSON` turns it on globally.

Find the schema for any command:

```bash
sf which org list          # => plugin: @salesforce/plugin-org
# schema: https://github.com/salesforcecli/plugin-org/blob/main/schemas/org-list.json
```

Salesforce commits to additive-only changes in these payloads; removing a property or changing its
type goes through a deprecation period gated behind an environment variable.

## `sf org display --json`

```json
{
  "status": 0,
  "result": {
    "id": "00D8H0000007wprU",
    "username": "test-gm9uud@example.com",
    "alias": "vf-dev",
    "apiVersion": "67.0",
    "instanceUrl": "https://java-connect-41-dev-ed.scratch.my.salesforce.com",
    "clientId": "PlatformCLI",
    "accessToken": "[REDACTED] Use 'sf org auth show-access-token' to view",
    "connectedStatus": "Connected",
    "orgName": "Your Company",
    "edition": "Developer",
    "status": "Active",
    "devHubId": "jdoe@fabdevhub.org",
    "createdBy": "jdoe@fabdevhub.org",
    "createdDate": "2026-06-09T17:59:18.000+0000",
    "expirationDate": "2026-06-16",
    "signupUsername": "test-gm9uud@example.com"
  },
  "warnings": []
}
```

`--verbose` adds `sfdxAuthUrl`. Secrets are redacted in this payload by design; use
`sf org auth show-access-token|show-sfdx-auth-url|show-user-password` with `--no-prompt`.

```bash
# Guard: refuse to continue unless the org answers.
sf org display --target-org "$ORG" --json \
  | jq -er 'select(.result.connectedStatus=="Connected") | .result.instanceUrl'

# Does the org still exist, and when does it expire?
sf org display --target-org "$ORG" --json | jq -r '[.result.status, .result.expirationDate] | @tsv'

# Is this a production-shaped org? (no devHubId, not a scratch org)
sf org display --target-org "$ORG" --json | jq -e '.result.devHubId == null' >/dev/null \
  && echo "treat as production"
```

## `sf org list --json`

```json
{
  "status": 0,
  "result": {
    "other": [],
    "sandboxes": [],
    "nonScratchOrgs": [],
    "devHubs": [],
    "scratchOrgs": [
      {
        "username": "test-fake@example.com",
        "alias": "myscratch",
        "orgId": "00DIfakefx2AC",
        "instanceUrl": "https://connect.scratch.my.salesforce.com",
        "isScratch": true,
        "isSandbox": false,
        "isDevHub": false,
        "devHubUsername": "jules@sf.com",
        "expirationDate": "2026-05-16",
        "isExpired": false,
        "status": "Active",
        "tracksSource": true,
        "instanceApiVersion": "67.0",
        "isDefaultUsername": false,
        "isDefaultDevHubUsername": false
      }
    ]
  },
  "warnings": []
}
```

```bash
# Alias -> username map for every authorized org.
sf org list --all --json \
  | jq -r '[.result.scratchOrgs[]?, .result.nonScratchOrgs[]?, .result.sandboxes[]?, .result.devHubs[]?]
           | map(select(.alias)) | .[] | "\(.alias)\t\(.username)"'

# Scratch orgs expiring within two days.
sf org list --json | jq -r --arg cutoff "$(date -u -v+2d +%Y-%m-%d 2>/dev/null || date -u -d '+2 days' +%Y-%m-%d)" \
  '.result.scratchOrgs[] | select(.expirationDate <= $cutoff) | .alias // .username'

# Is the alias vibe-force is about to deploy to actually source-tracked?
sf org list --json | jq -er --arg a "$ORG" \
  '[.result.scratchOrgs[]?, .result.sandboxes[]?] | map(select(.alias==$a)) | .[0].tracksSource'
```

## `sf project deploy start|validate|report|quick --json`

`result` is the `DeployResultJson` shape: the Metadata API `DeployResult` fields plus a per-file
array.

```json
{
  "status": 0,
  "result": {
    "id": "0Af8D00000pNtEUSA0",
    "status": "Succeeded",
    "success": true,
    "done": true,
    "checkOnly": false,
    "createdDate": "2026-09-12T09:41:02.000Z",
    "completedDate": "2026-09-12T09:43:55.000Z",
    "numberComponentsDeployed": 42,
    "numberComponentsTotal": 42,
    "numberComponentErrors": 0,
    "numberTestsCompleted": 118,
    "numberTestErrors": 0,
    "runTestsEnabled": true,
    "rollbackOnError": true,
    "ignoreWarnings": false,
    "zipSize": 184320,
    "zipFileCount": 96,
    "deployUrl": "https://.../lightning/setup/DeployStatus/page?address=...",
    "files": [
      {
        "fullName": "AccountService",
        "type": "ApexClass",
        "state": "Changed",
        "filePath": "force-app/main/default/classes/AccountService.cls"
      },
      {
        "fullName": "BadClass",
        "type": "ApexClass",
        "state": "Failed",
        "filePath": "force-app/main/default/classes/BadClass.cls",
        "error": "Variable does not exist: foo",
        "problemType": "Error",
        "lineNumber": 12,
        "columnNumber": 9
      }
    ],
    "details": {
      "componentFailures": [],
      "componentSuccesses": [],
      "runTestResult": {
        "numFailures": "0",
        "numTestsRun": "118",
        "totalTime": "62110.0",
        "codeCoverage": [],
        "codeCoverageWarnings": [],
        "failures": [],
        "successes": []
      }
    }
  },
  "warnings": []
}
```

`status` values come from `RequestStatus`: `Pending`, `InProgress`, `Succeeded`, `SucceededPartial`,
`Failed`, `Canceling`, `Canceled`, `Finalizing`, `FinalizingFailed`. Per-file `state` is `Created`,
`Changed`, `Unchanged`, or `Deleted` on success, and `Failed` on the failure variant, which adds
`error`, `problemType` (`Warning`/`Error`), `lineNumber`, and `columnNumber`. With `--async`,
`result` is the `AsyncDeployResultJson` shape — essentially `{ id, done: false, status: "Queued" }`
plus the follow-up command to run.

```bash
# Record the validation job id for a later quick deploy (what vf-check deploy-validate does).
job=$(sf project deploy validate --target-org "$ORG" --source-dir force-app \
        --test-level RunLocalTests --json | jq -r '.result.id')
echo "$job" > .vibeforce/state/deploy-jobs.json.tmp

sf project deploy quick --job-id "$job" --target-org "$ORG" --json | jq -r '.result.status'

# Every component error as file:line -> message.
sf project deploy report --job-id "$job" --target-org "$ORG" --json \
  | jq -r '.result.files[] | select(.state=="Failed")
           | "\(.filePath // .fullName):\(.lineNumber // 0) [\(.type)] \(.error)"'

# Apex test failures from the same payload.
sf project deploy report --job-id "$job" --target-org "$ORG" --json \
  | jq -r '.result.details.runTestResult.failures[]? | "\(.name).\(.methodName): \(.message)"'

# Class-level coverage below the gate.
sf project deploy report --job-id "$job" --target-org "$ORG" --json \
  | jq -r --argjson min 75 '.result.details.runTestResult.codeCoverage[]?
      | (100 - (.numLocationsNotCovered | tonumber) * 100 / (.numLocations | tonumber)) as $pct
      | select($pct < $min) | "\(.name) \($pct|floor)%"'
```

## `sf apex run test --json`

```json
{
  "status": 0,
  "result": {
    "summary": {
      "outcome": "Passed",
      "testsRan": 118,
      "passing": 118,
      "failing": 0,
      "skipped": 0,
      "passRate": "100%",
      "failRate": "0%",
      "testStartTime": "2026-09-12T09:41:02.000Z",
      "testExecutionTime": "62110 ms",
      "testTotalTime": "62110 ms",
      "commandTime": "64002 ms",
      "testRunId": "707xx0000AUS2gH",
      "userId": "005xx000000abcAAA",
      "orgId": "00D8H0000007wprU",
      "username": "test-gm9uud@example.com",
      "testRunCoverage": "87%",
      "orgWideCoverage": "86%"
    },
    "tests": [
      {
        "Id": "07Mxx00000F2Xh6",
        "ApexClass": { "Id": "01pxx0000000001", "Name": "AccountServiceTest", "NamespacePrefix": null },
        "MethodName": "createsAccountWithDefaults",
        "Outcome": "Pass",
        "RunTime": 143,
        "FullName": "AccountServiceTest.createsAccountWithDefaults",
        "Message": null,
        "StackTrace": null
      }
    ],
    "coverage": {
      "coverage": [
        {
          "id": "01pxx0000000002",
          "name": "AccountService",
          "totalLines": 120,
          "totalCovered": 104,
          "coveredPercent": 86,
          "lines": {}
        }
      ],
      "summary": { "totalLines": 3200, "coveredLines": 2752, "orgWideCoverage": "86%", "testRunCoverage": "87%" }
    }
  },
  "warnings": []
}
```

`summary.outcome` uses `ApexTestRunResultStatus` (`Passed`, `Failed`, `Completed`, `Processing`,
`Queued`, `Aborted`, `Skipped`); per-test `Outcome` uses `ApexTestResultOutcome` (`Pass`, `Fail`,
`CompileFail`, `Skip`). The `testRunCoverage` / `orgWideCoverage` strings include the `%` sign, and
`testExecutionTime`, `testTotalTime`, `commandTime` are strings rather than numbers (the exact
formatting of those duration strings is `[unverified]`; parse defensively with
`capture("(?<ms>[0-9]+)")`). Per-test entries carry `ApexClass`, `MethodName`, `FullName`,
`Outcome`, `RunTime`, `Message`, `StackTrace`, `QueueItemId`, `AsyncApexJobId`, and `Id`.

```bash
# Gates used by vf-check apex.
out=$(sf apex run test --target-org "$ORG" --test-level RunLocalTests --code-coverage \
        --wait 60 --json)
echo "$out" | jq -er '.result.summary.outcome == "Passed"' >/dev/null || exit 1
echo "$out" | jq -er '(.result.summary.orgWideCoverage | rtrimstr("%") | tonumber) >= 85' >/dev/null || exit 1
echo "$out" | jq -r --argjson min 75 '.result.coverage.coverage[]
  | select(.coveredPercent < $min) | "\(.name) \(.coveredPercent)%"'

# Failures with stack traces, for the report file.
echo "$out" | jq -r '.result.tests[] | select(.Outcome!="Pass")
  | "\(.FullName): \(.Message)\n\(.StackTrace)"'

# Async run: capture the id, fetch later.
id=$(sf apex run test --target-org "$ORG" --test-level RunSpecifiedTests \
       --tests AccountServiceTest --json | jq -r '.result.testRunId')
sf apex get test --test-run-id "$id" --target-org "$ORG" --code-coverage --json | jq '.result.summary'
```

## `sf data query --json`

```json
{
  "status": 0,
  "result": {
    "records": [
      {
        "attributes": { "type": "Account", "url": "/services/data/v67.0/sobjects/Account/001xx000003DGb2AAG" },
        "Id": "001xx000003DGb2AAG",
        "Name": "Edge Communications"
      }
    ],
    "totalSize": 1,
    "done": true
  },
  "warnings": []
}
```

`COUNT()` queries return `records: [{ "expr0": 42 }]` with `totalSize` reflecting the aggregate row
count, so assert on `records[0].expr0` for counts. With `--output-file`, `result.outputFile` holds
the path.

```bash
# Row-count assertion (post-load or post-deploy verification).
sf data query --target-org "$ORG" --json \
  --query "SELECT COUNT() FROM Contact WHERE AccountId != null" \
  | jq -er '.result.totalSize > 0' >/dev/null

# Aggregate value.
sf data query --target-org "$ORG" --json \
  --query "SELECT COUNT(Id) total FROM Case WHERE IsClosed = false" \
  | jq -r '.result.records[0].total'

# Field-level spot check with a flat TSV for the report.
sf data query --target-org "$ORG" --json \
  --query "SELECT Id, Name, Industry FROM Account LIMIT 5" \
  | jq -r '.result.records[] | [.Id, .Name, .Industry] | @tsv'

# Tooling API objects: add --use-tooling-api.
sf data query --target-org "$ORG" --use-tooling-api --json \
  --query "SELECT Id, Name, ApiVersion FROM ApexClass WHERE NamespacePrefix = null" \
  | jq -r '.result.records[] | "\(.Name) v\(.ApiVersion)"'
```

## Bulk data commands

| Command | `result` shape |
| --- | --- |
| `data import bulk` | `{ jobId, processedRecords, successfulRecords, failedRecords }` (`jobId` always present) |
| `data export bulk` | `{ jobId, totalSize, filePath }` (`filePath` always present) |
| `data bulk results` | `{ status, operation, object, processedRecords, successfulRecords, failedRecords, successFilePath, failedFilePath, unprocessedFilePath }` |
| `data delete bulk`, `data update bulk`, `data upsert bulk` and their `resume` commands | same ingest shape as `data import bulk` |

`status` is one of `Open`, `UploadComplete`, `InProgress`, `JobComplete`, `Aborted`, `Failed`;
`operation` is one of `insert`, `update`, `upsert`, `delete`, `hardDelete`, `query`, `queryAll`.

```bash
# Load, then poll, then assert zero failures.
job=$(sf data import bulk --target-org "$ORG" --file data/accounts.csv --sobject Account \
        --column-delimiter COMMA --wait 0 --json | jq -r '.result.jobId')

until [ "$(sf data bulk results --job-id "$job" --target-org "$ORG" --json | jq -r '.result.status')" \
        != "InProgress" ]; do sleep 10; done

sf data bulk results --job-id "$job" --target-org "$ORG" --json \
  | jq -er '.result.status=="JobComplete" and (.result.failedRecords // 0) == 0' >/dev/null \
  || { sf data bulk results --job-id "$job" --target-org "$ORG" --json \
         | jq -r '"failures in \(.result.failedFilePath)"'; exit 1; }
```

## Error payloads

```json
{
  "status": 1,
  "name": "NoOrgFound",
  "message": "No authorization information found for vf-int.",
  "exitCode": 1,
  "context": "project:deploy:start",
  "commandName": "project:deploy:start",
  "warnings": [],
  "stack": "NoOrgFound: ..."
}
```

The exact property set varies by error class `[unverified: no published schema for the failure
envelope]`; `status`, `name`, and `message` are the stable trio used in practice.

```bash
# Classify a failure without reading human output.
out=$(sf project deploy start --target-org "$ORG" --source-dir force-app --json 2>&1) || {
  name=$(printf '%s' "$out" | jq -r '.name // "Unknown"')
  case "$name" in
    NoOrgFound|NamedOrgNotFoundError|AuthInfoCreationError) exit 3 ;;  # org/network -> vf-check exit 3
    *) exit 1 ;;                                                        # gate failure
  esac
}
```

Combine with `SF_JSON_TO_STDOUT=true` so the failure JSON lands on stdout and `2>&1` is unnecessary.

## Report files written by vibe-force

`vf-check` normalizes any of the above into
`<project>/.vibeforce/reports/<check>-<ISO>.json`:

```json
{
  "check": "apex",
  "startedAt": "2026-09-12T09:41:02.001Z",
  "durationMs": 64002,
  "status": "fail",
  "gates": { "apexOrgCoverageMin": { "expected": 85, "actual": 82, "pass": false } },
  "findings": [
    { "severity": "error", "kind": "coverage", "name": "AccountService", "message": "72% < 75%" }
  ],
  "raw": { }
}
```

`raw` holds the untouched `result` object from the underlying `sf` command, so any recipe in this
file also works against a stored report:

```bash
jq -r '.raw.summary.orgWideCoverage' .vibeforce/reports/apex-*.json | tail -1
```

## Sources

- Salesforce CLI Setup Guide, "JSON Response Change Policy" and "Find the JSON Schema File for a Command": <https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_intro.htm>
- `org-display.json`, `org-list.json` schemas: <https://github.com/salesforcecli/plugin-org/tree/main/schemas>
- `project-deploy-start.json`, `project-deploy-validate.json` schemas: <https://github.com/salesforcecli/plugin-deploy-retrieve/tree/main/schemas>
- `apex-run-test.json` schema: <https://github.com/salesforcecli/plugin-apex/tree/main/schemas>
- `data-query.json`, `data-import-bulk.json`, `data-export-bulk.json`, `data-bulk-results.json` schemas: <https://github.com/salesforcecli/plugin-data/tree/main/schemas>
