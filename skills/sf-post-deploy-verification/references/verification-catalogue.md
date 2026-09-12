# Verification Catalogue

Change type -> checks -> exact commands -> pass criteria. Every command is `sf` v2 with an explicit
`--target-org`. `<alias>` is an alias from `orgs` in `.vibeforce/config.json`
(`dev`, `integration`, `uat`, `prod`). API version comes from `apiVersion` (`67.0`) in
`config/vibe-force.defaults.json`.

## Always-run baseline (every deploy, every change type)

| # | Check | Command | Pass criteria |
| --- | --- | --- | --- |
| B1 | Deploy result | `sf project deploy report --job-id <id> --target-org <alias> --json` | `result.status = "Succeeded"`, `numberComponentErrors = 0`, `details.componentFailures` empty |
| B2 | Test result inside the deploy | same JSON | `numberTestErrors = 0`, `details.runTestResult.numFailures = "0"` |
| B3 | Coverage warnings | same JSON | `details.runTestResult.codeCoverageWarnings` empty, or each warning reviewed and accepted |
| B4 | Org reachable as expected identity | `sf org display --target-org <alias> --json` | `result.connectedStatus = "Connected"`; `result.username` is the intended deploy user |
| B5 | Production guard | `sf data query --query "SELECT IsSandbox, OrganizationType, InstanceName FROM Organization LIMIT 1" --target-org <alias>` | `IsSandbox` matches the expectation for that alias; a probe that writes data requires `IsSandbox = true` |
| B6 | New async failures | `sf data query --query "SELECT COUNT(Id) FROM AsyncApexJob WHERE Status IN ('Failed','Aborted') AND CreatedDate = TODAY" --target-org <alias>` | Count equals the pre-deploy baseline (normally 0) |
| B7 | Limits headroom | `sf org list limits --target-org <alias> --json` | `DailyApiRequests`, `DailyAsyncApexExecutions`, `DataStorageMB` remaining above the configured threshold |
| B8 | Report artefact | `vf-check smoke --target-org <alias>` | `.vibeforce/reports/smoke-<ISO>.json` exists with `status: "pass"` |

## Apex-only change

| # | Check | Command | Pass criteria |
| --- | --- | --- | --- |
| A1 | Changed classes' tests | `sf apex run test --tests OrderServiceTest --tests BillingGatewayTest --code-coverage --result-format json --wait 20 --target-org <alias>` | `summary.outcome = "Passed"`, `summary.failing = 0` |
| A2 | Class coverage gate | same run | Each changed class >= `gates.apexClassCoverageMin` (75) |
| A3 | Org coverage gate | `sf apex run test --test-level RunLocalTests --code-coverage --result-format json --wait 60 --target-org <alias>` | `summary.testRunCoverage` / org coverage >= `gates.apexOrgCoverageMin` (85) |
| A4 | Class is active in the org at the right version | `sf data query --use-tooling-api --query "SELECT Name, ApiVersion, Status, LengthWithoutComments FROM ApexClass WHERE Name IN ('OrderService','BillingGateway')" --target-org <alias>` | `Status = "Active"`, `ApiVersion = 67.0` |
| A5 | Trigger active | `sf data query --use-tooling-api --query "SELECT Name, TableEnumOrId, Status FROM ApexTrigger WHERE Name = 'OrderTrigger'" --target-org <alias>` | `Status = "Active"` |
| A6 | Runtime smoke | `sf apex run --file scripts/apex/smoke-core.apex --target-org <alias> --json` | `result.compiled = true`, `result.success = true` |
| A7 | No new unhandled exceptions | `sf apex list log --target-org <alias> --json` then `sf apex get log --log-id <id> --target-org <alias>` | No `FATAL_ERROR` / `System.` exception lines in logs from the probe window |
| A8 | Async entry points still complete | `sf data query --query "SELECT ApexClass.Name, Status, ExtendedStatus, NumberOfErrors FROM AsyncApexJob WHERE CreatedDate = TODAY ORDER BY CreatedDate DESC" --target-org <alias>` | No `Failed`, no non-null `ExtendedStatus` for the changed classes |

## LWC-only change

| # | Check | Command | Pass criteria |
| --- | --- | --- | --- |
| L1 | Jest suite | `vf-check jest --changed` | All tests pass, coverage >= `gates.jestCoverageMin` (80) |
| L2 | Bundle deployed | `sf org list metadata --metadata-type LightningComponentBundle --target-org <alias> --json` | The bundle appears with the expected `lastModifiedDate` |
| L3 | Wired Apex still callable | `sf apex run --file scripts/apex/smoke-lwc-controllers.apex --target-org <alias> --json` | `result.success = true` (each `@AuraEnabled` method invoked and asserted) |
| L4 | Visual confirmation | `sf org open --path lightning/o/Order__c/list --target-org <alias>` | Component renders, no browser console errors |
| L5 | URL for the report without opening a browser | `sf org open --path lightning --url-only --target-org <alias>` | URL captured in the verification report |
| L6 | Exposure/targets correct | inspect `*.js-meta.xml` in source plus L4 | Component appears on the intended page types only |

A query cannot prove a component rendered. L4 is mandatory for user-facing LWC work; automate it
with Playwright or UTAM only in a dedicated suite, never inside `vf-check`.

## Schema change (object, field, record type, picklist)

| # | Check | Command | Pass criteria |
| --- | --- | --- | --- |
| S1 | Object/field exist and are visible | `sf apex run --file scripts/apex/smoke-schema.apex --target-org <alias> --json` | `result.success = true` (describe assertions inside) |
| S2 | Field definition metadata | `sf data query --use-tooling-api --query "SELECT QualifiedApiName, DataType, IsIndexed FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = 'Order__c'" --target-org <alias>` | New fields present with the expected `DataType` |
| S3 | Picklist values | `sf data query --use-tooling-api --query "SELECT Value, Label, IsActive, IsDefaultValue FROM PicklistValueInfo WHERE EntityParticle.EntityDefinition.QualifiedApiName = 'Order__c' AND EntityParticle.QualifiedApiName = 'Status__c' AND IsActive = true" --target-org <alias>` | Expected value set, exactly one default |
| S4 | Record types available | `sf data query --query "SELECT DeveloperName, Name, IsActive FROM RecordType WHERE SobjectType = 'Order__c'" --target-org <alias>` | Expected record types active |
| S5 | Record type assignment for the running profile | `sf apex run --file scripts/apex/smoke-schema.apex --target-org <alias> --json` | Describe-based assertion that the record type is available to the user |
| S6 | Referential integrity after the change | `sf data query --query "SELECT COUNT(Id) FROM Order_Line__c WHERE Order__c = null" --target-org <alias>` | 0 orphans (or the known pre-existing count) |
| S7 | Required-field regressions | `sf apex run test --test-level RunLocalTests --result-format json --wait 60 --target-org <alias>` | No failures caused by a newly required field |
| S8 | Storage impact | `sf org list limits --target-org <alias> --json` | `DataStorageMB` remaining acceptable |
| S9 | External Id uniqueness (if added) | `sf data query --query "SELECT External_Id__c, COUNT(Id) FROM Order__c GROUP BY External_Id__c HAVING COUNT(Id) > 1" --target-org <alias>` | Zero rows |

## Permission change (permission set, permission set group, profile, sharing)

| # | Check | Command | Pass criteria |
| --- | --- | --- | --- |
| P1 | Permission set deployed | `sf org list metadata --metadata-type PermissionSet --target-org <alias> --json` | Present with the expected timestamp |
| P2 | Assignments exist | `sf data query --query "SELECT PermissionSet.Name, Assignee.Username, Assignee.IsActive FROM PermissionSetAssignment WHERE PermissionSet.Name = 'Order_Management'" --target-org <alias>` | Every intended user assigned, all active |
| P3 | Object/field permissions granted | `sf data query --query "SELECT Parent.Name, SobjectType, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete FROM ObjectPermissions WHERE Parent.Name = 'Order_Management'" --target-org <alias>` | Matches the intended matrix |
| P4 | Field-level security | `sf data query --query "SELECT Parent.Name, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE Parent.Name = 'Order_Management' AND SobjectType = 'Order__c'" --target-org <alias>` | Sensitive fields not readable where they should not be |
| P5 | Positive runtime check | `sf apex run --file scripts/apex/smoke-permissions.apex --target-org <alias> --json` | Assertions on `Schema.sObjectType.<X>.isAccessible()/isCreateable()/isUpdateable()` pass |
| P6 | Negative runtime check | `System.runAs` test in an Apex test class (`sf apex run test --tests PermissionNegativeTest ...`) | A user without the permission set is denied |
| P7 | External credential principal access (integrations) | `sf data query --query "SELECT PermissionSet.Name, Assignee.Username FROM PermissionSetAssignment WHERE PermissionSet.Name = 'Billing_Integration'" --target-org <alias>` | Integration user assigned |
| P8 | Assignment count did not explode | `sf data query --query "SELECT COUNT(Id) FROM PermissionSetAssignment WHERE PermissionSet.Name = 'Order_Management'" --target-org <alias>` | Count equals the planned number |

Permission verification needs both directions: granted to the intended audience, denied to everyone
else. See skill `sf-security-model`.

## Integration change (named credential, callout, platform event, external service)

| # | Check | Command | Pass criteria |
| --- | --- | --- | --- |
| I1 | Credential metadata present | `sf org list metadata --metadata-type NamedCredential --target-org <alias> --json` and the same for `ExternalCredential` | Both present |
| I2 | Endpoint reachable via the credential | `sf apex run --file scripts/apex/smoke-integration.apex --target-org <alias> --json` | `result.success = true`, probe logged HTTP 200 from a sandbox endpoint |
| I3 | Inbound Apex REST answers | `sf api request rest "/services/apexrest/order-sync/?externalId=EXT-SMOKE" --method GET --include --target-org <alias>` | HTTP 200 with the agreed payload shape |
| I4 | Platform event round trip | `sf api request rest "/services/data/v67.0/sobjects/Order_Submitted__e" --method POST --body '{"Order_Id__c":"SMOKE","Correlation_Id__c":"vf-smoke-1"}' --target-org <alias>` then query the subscriber's log object | Subscriber wrote exactly one row for `vf-smoke-1` |
| I5 | Event channel/members deployed (CDC) | `sf org list metadata --metadata-type PlatformEventChannel --target-org <alias> --json` | Channel and members present |
| I6 | Dead letters clean | `sf data query --query "SELECT COUNT(Id) FROM Integration_Dead_Letter__c WHERE CreatedDate = TODAY AND Status__c = 'New'" --target-org <alias>` | 0 |
| I7 | Event allocations | `sf org list limits --target-org <alias> --json` | `HourlyPublishedPlatformEvents`, `DailyDeliveredPlatformEvents` remaining healthy |
| I8 | External service registration | `sf org list metadata --metadata-type ExternalServiceRegistration --target-org <alias> --json` | Registration present; operations active |
| I9 | No callout exceptions in logs | `sf apex list log --target-org <alias> --json` + `sf apex get log` | No `CalloutException` in the probe window |

Never point a smoke probe at a third-party production endpoint. Detail: skill
`sf-integration-patterns`.

## Flow change

| # | Check | Command | Pass criteria |
| --- | --- | --- | --- |
| F1 | Active version | `sf data query --query "SELECT ApiName, Label, IsActive, ProcessType, TriggerType, ActiveVersionId FROM FlowDefinitionView WHERE ApiName = 'Order_Routing'" --target-org <alias>` | `IsActive = true`; `ActiveVersionId` changed as expected |
| F2 | Version number | `sf data query --query "SELECT FlowDefinitionViewId, VersionNumber, Status FROM FlowVersionView WHERE FlowDefinitionView.ApiName = 'Order_Routing'" --target-org <alias>` | Newest version has `Status = "Active"` `[unverified field names - confirm against your org]` |
| F3 | Flow tests (when they exist) | `sf logic run test --test-category Flow --target-org <alias> --result-format json --wait 20` | All flow tests pass |
| F4 | Behavioural probe | `sf apex run --file scripts/apex/smoke-flow-effects.apex --target-org <alias> --json` | Records the flow should create/update exist with expected values (sandbox only) |
| F5 | Interview errors | `sf data query --query "SELECT COUNT(Id) FROM FlowInterview WHERE CreatedDate = TODAY" --target-org <alias>` | No unexpected paused interviews `[unverified - FlowInterview availability depends on org configuration]` |
| F6 | Fault-path logging | query the flow's error object/Case type | No new error rows from the probe window |
| F7 | Old version deactivated | F1 output | Exactly one active version |

## Scheduled job change

| # | Check | Command | Pass criteria |
| --- | --- | --- | --- |
| J1 | Job scheduled | `sf data query --query "SELECT CronJobDetail.Name, CronJobDetail.JobType, State, CronExpression, NextFireTime, PreviousFireTime, TimesTriggered FROM CronTrigger ORDER BY NextFireTime" --target-org <alias>` | Row exists with expected name; `State = "WAITING"`; `NextFireTime` in the future |
| J2 | No duplicate schedules | same query | Exactly one row per job name |
| J3 | Last run succeeded | `sf data query --query "SELECT ApexClass.Name, Status, ExtendedStatus, NumberOfErrors, CompletedDate FROM AsyncApexJob WHERE JobType IN ('ScheduledApex','BatchApex') AND CreatedDate = LAST_N_DAYS:1 ORDER BY CompletedDate DESC" --target-org <alias>` | `Status = "Completed"`, `NumberOfErrors = 0` |
| J4 | Schedule re-created after class change | J1 | Job re-scheduled if the deploy required aborting it |
| J5 | Async allocation | `sf org list limits --target-org <alias> --json` | `DailyAsyncApexExecutions` remaining healthy |

Deploying a scheduled Apex class sometimes requires aborting the job first; if the deploy aborted a
job, re-scheduling is part of verification, not an afterthought.

## Data load

| # | Check | Command | Pass criteria |
| --- | --- | --- | --- |
| D1 | Row count | `sf data query --query "SELECT COUNT(Id) FROM Order__c WHERE Load_Batch__c = 'VF-2026-09'" --target-org <alias>` | Equals the expected loaded count |
| D2 | Failed records | `sf data bulk results --job-id <bulkJobId> --target-org <alias>` | Zero failures, or failures triaged and re-loaded |
| D3 | Duplicates on the external id | `sf data query --query "SELECT External_Id__c, COUNT(Id) FROM Order__c GROUP BY External_Id__c HAVING COUNT(Id) > 1" --target-org <alias>` | Zero rows |
| D4 | Relationships populated | `sf data query --query "SELECT COUNT(Id) FROM Order_Line__c WHERE Order__c = null AND CreatedDate = TODAY" --target-org <alias>` | 0 |
| D5 | Automation side effects | `sf data query --query "SELECT COUNT(Id) FROM AsyncApexJob WHERE Status = 'Failed' AND CreatedDate = TODAY" --target-org <alias>` | 0 |
| D6 | Bulk allocation | `sf org list limits --target-org <alias> --json` | `DailyBulkApiBatches` and `DailyBulkV2QueryJobs` remaining healthy |
| D7 | Storage | same limits output | `DataStorageMB` remaining acceptable |

Loading mechanics, CSV shaping, and `sf data import bulk` flags: skill `sf-data-management`.

## Metadata-only / configuration change (custom metadata, layouts, tabs, custom settings)

| # | Check | Command | Pass criteria |
| --- | --- | --- | --- |
| C1 | Custom metadata rows | `sf data query --query "SELECT DeveloperName, Label FROM Integration_Setting__mdt ORDER BY DeveloperName" --target-org <alias>` | Expected rows present with expected values |
| C2 | Hierarchy custom setting defaults | `sf apex run --file scripts/apex/smoke-config.apex --target-org <alias> --json` | `getOrgDefaults()` returns non-null with expected flags |
| C3 | Layout assignment | `sf org list metadata --metadata-type Layout --target-org <alias> --json` plus `sf org open --path` spot check | Layout deployed and assigned |
| C4 | Tab/app visibility | `sf org open --path lightning/app/<AppApiName> --target-org <alias>` | App and tabs visible to the intended profile |
| C5 | Feature flag behaviour | `scripts/apex/smoke-config.apex` | Service behaviour matches the flag state |

## Release gate (production deploy)

| # | Check | Command | Pass criteria |
| --- | --- | --- | --- |
| R1 | Validation before the window | `sf project deploy validate --source-dir force-app --test-level RunLocalTests --target-org prod --async` | Returns a job id; validation `Succeeded` |
| R2 | Quick deploy inside the window | `sf project deploy quick --job-id <id> --target-org prod` | `Succeeded` |
| R3 | Job id still valid | n/a | Quick deploy used within 10 days of validation |
| R4 | Post-deploy tests | `sf apex run test --test-level RunLocalTests --code-coverage --result-format json --wait 60 --target-org prod` | Zero failures; coverage gates met |
| R5 | Read-only smoke | `sf apex run --file scripts/apex/smoke-core.apex --target-org prod --json` | `success = true`; the script performs no DML because `IsSandbox = false` |
| R6 | Limits and health | `sf org list limits --target-org prod --json` | No allocation near exhaustion |
| R7 | Rollback plan recorded | n/a | Previous release commit sha and the disable switch documented in the report |

Production runs are additionally gated by `hooks.blockProductionDeploy` and `productionAliases` in
`.vibeforce/config.json`; the vibe-force hooks block a production deploy unless `VF_ALLOW_PROD=1` is
set deliberately. Release mechanics: skill `sf-deployment-strategies`.

## Pass-criteria conventions

| Term | Meaning in this catalogue |
| --- | --- |
| "clean" | Command exits 0 and the JSON shows zero errors/failures |
| "baseline" | The same query run before the deploy; store it in the report's `raw` block |
| "healthy" | `remaining / max` above the threshold configured for the check (default 20% remaining) |
| "expected" | Written into `.vibeforce/state/contract.md` during wave 0, not invented during wave 4 |

## Cross-references

- Probe sources: `smoke-apex-scripts.md`
- Query library: `org-health-queries.md`
- What to do when a row fails: `failure-triage.md`
- Deploy/validate/quick mechanics: skill `sf-deployment-strategies`
- Apex test authoring: skill `sf-apex-testing`
- Log capture: skill `sf-debugging-logs`
