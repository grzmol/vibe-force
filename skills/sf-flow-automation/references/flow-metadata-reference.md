# Flow metadata reference

Source: Metadata API Developer Guide, types `Flow`, `FlowDefinition`, `FlowTest`, Summer '26 /
API version 67.0 (`atlas.en-us.262.0.api_meta.meta`). Only the fields a vibe-force agent actually
edits or reviews are reproduced; the type has many more.

## Directory and file shape

| Type | Directory | Suffix | Available from |
| --- | --- | --- | --- |
| `Flow` | `flows/` | `.flow-meta.xml` in a source-format project | - |
| `FlowDefinition` | `flowDefinitions/` | `.flowDefinition` | API 34.0 |
| `FlowTest` | `flowtests/` | `.flowtest` | API 55.0 |

In a vibe-force project `flows/**` belongs to the `sf-metadata-engineer` slice
(`scripts/lib/sf-paths.js`), and the file classifier tags anything matching `*.flow-meta.xml` as
kind `flow`.

## `Flow` - the `start` element fields that decide behaviour

| Field | Type | Notes |
| --- | --- | --- |
| `triggerType` | `FlowTriggerType` | What causes the flow to run. Omit it and the flow has no trigger: it starts only when a user or app launches it. Available only when `processType` is `AutoLaunchedFlow` or `PromptFlow`. API 47.0 and later |
| `recordTriggerType` | `RecordTriggerType` | What kind of record change starts the flow. Available only when `triggerType` is `RecordBeforeSave` or `DataCloudDataChange`. API 48.0 and later |
| `object` | string | The sObject the flow triggers on |
| `filters` / `filterLogic` | `FlowRecordFilter[]` / string | Entry conditions |
| `doesRequireRecordChangedToMeetCriteria` | boolean | Run only on the save where the record *became* matching |
| `schedule` | `FlowSchedule` | Required when `triggerType` is `Scheduled` |
| `scheduledPaths` | `FlowScheduledPath[]` | Time-offset paths. API 51.0 and later |
| `segment` | string | Segment used to trigger the flow. API 56.0 and later |

### `FlowTriggerType` values

| Value | Meaning | From |
| --- | --- | --- |
| `RecordBeforeSave` | Creating or updating a record triggers an autolaunched flow to make more updates to that record **before** it is saved | API 48.0 |
| `RecordAfterSave` | The flow starts **after** a record is saved | API 49.0 |
| `RecordBeforeDelete` | Deleting a record triggers an autolaunched flow before the record leaves the database | API 50.0 |
| `PlatformEvent` | The flow starts when a platform event message is received | API 49.0 |
| `Scheduled` | The flow starts at the scheduled time | API 47.0 |
| `ScheduledJourney` | The flow starts only at the scheduled time and frequency | API 49.0 |
| `Segment` | At the scheduled time, sends emails to individuals in the chosen segment | API 56.0 |
| `Capability` | When `capabilityTypes` is set, the flow starts when the capability runs | API 60.0 |
| `DataCloudDataChange` | Starts when data model object or calculated insight object conditions are met | API 59.0 |
| `DataGraphDataChange` | Starts when conditions are met in the specified data graph field | API 63.0 |
| `AutomationEvent` | Starts when an automation event such as an SMS subscription occurs | API 62.0 |
| `Activation` | Starts when an activation is published | API 63.0 |
| `ExternalSystemChange` | Starts when a relevant change is detected in an external system | API 63.0 |
| `IndivRelatedRecord` | Starts when an object, or an object with fields related to an individual, is created or updated | API 66.0 |
| `EventDrivenJourney` | Reserved for internal use | - |

The four that matter for ordinary record automation are `RecordBeforeSave`, `RecordAfterSave`,
`RecordBeforeDelete` and `PlatformEvent`.

### `RecordTriggerType` values

| Value | Meaning | From |
| --- | --- | --- |
| `Create` | When a record is created | - |
| `Update` | When a record is updated | - |
| `CreateAndUpdate` | Both | - |
| `Delete` | When a record is deleted | API 50.0 |
| `None` | For flows that are not record-triggered | API 55.0 |

### Other `Flow` fields worth knowing

| Field | Notes |
| --- | --- |
| `status` | `Active`, `Draft`, `Obsolete`, `InvalidDraft`. The modern activation mechanism |
| `processType` | `AutoLaunchedFlow` for record-triggered and scheduled flows; `Flow` for screen flows |
| `apiVersion` | Keep in step with `config/vibe-force.defaults.json`; the post-edit hook flags drift |
| `sendMsgToOneContactPtPerIndv` | Segment-triggered flows only. Must be `true` if `activationTemplate` is set. API 66.0 |
| `triggeringDataGraph`, `triggeringDataModelObjectPath` | Data Cloud triggers. API 63.0 |
| `TimeZoneSidKey` | Reserved for future use. Do not set |
| `versionString` | Version of the automation event. API 65.0 |

## `FlowDefinition` - legacy, and it overrides you

Represents the flow definition's description and active flow version number.

| Field | Type | Description |
| --- | --- | --- |
| `activeVersionNumber` | int | The version number of the active flow |
| `apiVersion` | int | Reserved for internal use |
| `description` | string | Description of the flow definition |
| `masterLabel` | string | Label. In managed packages this inherits the flow's active version name |

Two facts from the guide that decide how you should treat this type:

1. **The override.** "If you deploy with flow definitions, the active version numbers in the flow
   definitions override the status fields in the flows." The guide's own example: the definition
   says version 3, the latest flow is version 4 with status `Active`; after deployment **version 3
   is active**.
2. **The recommendation.** "In API version 44.0, we recommend upgrading your flows to flow metadata
   file names without version numbers and discontinue using the FlowDefinition object to activate
   or deactivate a flow. Then use the Flow object to activate or deactivate a flow."

`FlowDefinition` supports the `*` wildcard in `package.xml`.

Practical rule for a vibe-force repository: do not ship `flowDefinitions/`. If the directory
exists, treat removing it as part of the change, and verify with a retrieve that the org's active
version matches the repository.

## `FlowTest`

Represents the metadata associated with a flow test. Before you activate a record-triggered,
autolaunched or Data Cloud-triggered flow, you can test it to verify expected results and identify
run-time failures.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `label` | string | yes | The label of the flow test |
| `flowApiName` | string | yes | API name of the flow under test |
| `testType` | `FlowTestType` | yes | Whether the test contains assertions. `WithAssertion` means the actual outcome is compared automatically against the expected outcome the assertions define. API 66.0 |
| `description` | string | no | What the test does or how it works |
| `testPoints` | `FlowTestPoint[]` | no | The test points - parameters and assertions |
| `flowTestDataSources` | `FlowTestDataSource[]` | no | Data sources for a record-triggered or autolaunched flow test. API 66.0 |
| `flowTestFlowVersions` | `FlowTestFlowVersion[]` | no | Flow versions associated with the test. API 66.0 |
| `isolatedObjectExternalKeys` | `FlowTestIsolObjExtlKey[]` | no | Isolated objects and the key fields that uniquely identify each record. API 66.0 |

`FlowTestFlowVersion` carries `flowVersionNumber` (string), the version the test is pinned to.

`FlowTest` inherits `fullName` from the `Metadata` type. There are no special access requirements
for this type.

A `FlowTest` proves the flow behaves. It does **not** produce Apex code coverage: an
`@InvocableMethod` called by the flow still needs its own Apex test class (skill `sf-apex-testing`).

## Retrieval and inspection commands

```bash
# Retrieve one flow
sf project retrieve start --metadata Flow:My_Flow --target-org <alias>

# Retrieve every flow
sf project retrieve start --metadata Flow --target-org <alias>

# Retrieve flow tests
sf project retrieve start --metadata FlowTest --target-org <alias>

# What is active in the org, and at which version
sf data query \
  --query "SELECT Id, ApiName, Label, ProcessType, TriggerType, IsActive, ActiveVersionId FROM FlowDefinitionView ORDER BY Label" \
  --use-tooling-api --target-org <alias>

# Every version of one flow
sf data query \
  --query "SELECT Id, VersionNumber, Status, MasterLabel FROM Flow WHERE Definition.DeveloperName = 'My_Flow' ORDER BY VersionNumber" \
  --use-tooling-api --target-org <alias>
```

`FlowDefinitionView` is the readable summary; `Flow` in the Tooling API is the per-version detail.
Use the first to answer "is it on", the second to answer "which version is on".

## Deployment notes

| Situation | Behaviour | Handling |
| --- | --- | --- |
| Deploying a flow with `<status>Active</status>` | Activates that version on deploy | Normal path |
| Deploying an active flow into production | Can require flow test coverage depending on org configuration | Ship `FlowTest` metadata, or deploy inactive and activate afterwards |
| Deploying `FlowDefinition` alongside `Flow` | `activeVersionNumber` wins over `status` | Remove `flowDefinitions/` |
| Deleting a flow | Active versions cannot be deleted | Deactivate first, then use a destructive change |

Deploy mechanics, validation and quick deploy: skill `sf-deployment-strategies`.
