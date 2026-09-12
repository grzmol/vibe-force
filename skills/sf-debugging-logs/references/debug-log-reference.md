# Debug Log Reference

Tables for every knob and every log line you will read. Sources: Apex Developer Guide
[Debug Log](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_debugging_debug_log.htm),
[Working with Logs in the Developer Console](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_debugging_system_log_console.htm),
[Debug Log Order of Precedence](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_debugging_debug_log_precedence.htm);
Tooling API
[TraceFlag](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_traceflag.htm),
[DebugLevel](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_debuglevel.htm),
[ApexLog](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_apexlog.htm);
CLI reference
[apex commands](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_apex_commands_unified.htm).

## 1. Log categories

| Category (UI) | `TraceFlag`/`DebugLevel` field | Includes |
| --- | --- | --- |
| Database | `Database` | database activity: every DML statement and every inline SOQL or SOSL query |
| Database Access | `dataAccess` | rules and policy information for objects accessed from the UI; explains why an object is not accessible |
| Workflow | `Workflow` | workflow rules, flows, and processes: rule name and actions taken |
| NBA | `nba` | Einstein Next Best Action, including Strategy Builder execution details |
| Validation | `Validation` | validation rules: rule name and whether it evaluated true or false |
| Callout | `Callout` | request and response XML sent to and received from external web services; also Salesforce Connect external object access |
| Apex Code | `ApexCode` | Apex code: `System.debug` output, DML statements, inline SOQL/SOSL, trigger start and completion, test method start and completion |
| Apex Profiling | `ApexProfiling` | cumulative profiling: namespace limits, emails sent, and similar |
| Visualforce | `Visualforce` | Visualforce events including view state serialization and formula field evaluation |
| System | `System` | calls to all system methods, such as `System.debug` |
| Wave | `Wave` | CRM Analytics: template processing errors, rules execution summaries |

## 2. Log levels

`NONE`, `ERROR`, `WARN`, `INFO`, `DEBUG`, `FINE`, `FINER`, `FINEST`, listed lowest to highest. Levels
are cumulative: selecting `FINE` also logs everything at `DEBUG`, `INFO`, `WARN`, and `ERROR`. Not
every level exists for every category - only levels that correspond to at least one event are
available. Most events start being logged at `INFO`.

Practical level selection:

| Goal | Setting |
| --- | --- |
| See `System.debug` output and query/DML lines | `APEX_CODE=DEBUG`, `DB=INFO` |
| See method entry/exit and constructor calls | `APEX_CODE=FINE` |
| See per-line heap allocation and statement execution | `APEX_CODE=FINER` |
| See every variable assignment (PII risk, log-size risk) | `APEX_CODE=FINEST` |
| See limit consumption per namespace | `APEX_PROFILING=FINEST` |
| See query plans chosen by the optimizer | `DB=FINEST` (`SOQL_EXECUTE_EXPLAIN`) |
| See callout request and response bodies | `CALLOUT=INFO` |
| Debug Flow behaviour | `WORKFLOW=FINER` or higher |

Before running a deployment, verify `APEX_CODE` is not `FINEST`: deployments take substantially
longer. If the Developer Console is open, its log levels affect all logs, including deployment logs.

## 3. Default levels when no trace flag is active

Synchronous and asynchronous Apex tests execute with:

| Category | Level |
| --- | --- |
| `DB` | `INFO` |
| `APEX_CODE` | `DEBUG` |
| `APEX_PROFILING` | `INFO` |
| `WORKFLOW` | `INFO` |
| `VALIDATION` | `INFO` |
| `CALLOUT` | `INFO` |
| `VISUALFORCE` | `INFO` |
| `SYSTEM` | `DEBUG` |

## 4. `TraceFlag` fields

| Field | Type | Notes |
| --- | --- | --- |
| `ApexCode` | picklist | required; `NONE`..`FINEST` |
| `ApexProfiling` | picklist | required |
| `Callout` | picklist | required |
| `Database` | picklist | required |
| `System` | picklist | required |
| `Validation` | picklist | required |
| `Visualforce` | picklist | required |
| `Workflow` | picklist | required |
| `DebugLevelId` | reference | the `DebugLevel` assigned to this flag; one debug level can serve many flags |
| `LogType` | picklist | required; `CLASS_TRACING`, `DEVELOPER_LOG`, `PROFILING` (reserved for future use), `USER_DEBUG` |
| `TracedEntityId` | reference | required; an Apex class, an Apex trigger, or a user |
| `StartDate` | dateTime | when the flag takes effect; if null, the current time is used |
| `ExpirationDate` | dateTime | required; must be less than 24 hours after `StartDate` |
| `ScopeId` | reference | deprecated, API 34.0 and earlier |

Only one trace flag per traced entity can be active at a time. Supported calls: `create`, `delete`,
`describeSObjects`, `query`, `retrieve`, `update`, `upsert`; REST supports Query, GET, POST, PATCH,
DELETE.

`LogType` semantics:

| `LogType` | Set it for | Effect |
| --- | --- | --- |
| `USER_DEBUG` | a user | logs that user's activity; cannot be used for a class or trigger |
| `CLASS_TRACING` | an Apex class or trigger | overrides log levels for that class or trigger, including levels set by user trace flags, but does **not** cause logging to occur |
| `DEVELOPER_LOG` | a user | what the Developer Console sets on load |
| `PROFILING` | - | reserved for future use |

Because `CLASS_TRACING` alone generates nothing, raising verbosity for one class means: a
`USER_DEBUG` flag to make logging happen plus a `CLASS_TRACING` flag to raise the level for that
class.

## 5. `DebugLevel` fields

| Field | Notes |
| --- | --- |
| `DeveloperName` | internal name; also shown in the Developer Console and Setup. Viewing, grouping, sorting, and filtering it requires View DeveloperName or View Setup and Configuration |
| `MasterLabel` | reserved for future use, but required and must have a value; use the same value as `DeveloperName` |
| `Language` | language of `MasterLabel` (`en_US`, `ja`, `de`, ...) |
| `ApexCode`, `ApexProfiling`, `Callout`, `Database`, `System`, `Validation`, `Visualforce`, `Workflow` | required category levels |
| `dataAccess`, `nba`, `Wave` | optional category levels (`ApexLogLevel` enumeration) |

Deleting a debug level deletes every trace flag that uses it.

## 6. `ApexLog` fields

| Field | Notes |
| --- | --- |
| `Application` | client type: the client Id for API clients, `Browser` for browser clients (required) |
| `DurationMilliseconds` | transaction duration (required) |
| `Location` | `Monitoring` (debug log monitoring, visible to all administrators, kept 7 days) or `SystemLog` (system log monitoring, visible only to you, kept 24 hours) |
| `LogLength` | length in bytes (required) |
| `LogUserId` | user whose actions triggered the log |
| `Operation` | operation that triggered the log, such as `APEXSOAP` or `Apex Sharing Recalculation` (required) |
| `Request` | `API` or `Application` |

Retrieve a raw log body over REST with `/services/data/vXX.0/sobjects/ApexLog/<id>/Body/` (API 28.0
and later). Supported calls: `delete`, `describeSObjects`, `query`, `retrieve`; REST supports Query,
GET, DELETE.

Useful queries:

```bash
# largest logs first, to find the transaction that blew up
sf data query --use-tooling-api --target-org vf-dev \
  --query "SELECT Id, Operation, Status, LogLength, DurationMilliseconds, StartTime FROM ApexLog ORDER BY LogLength DESC LIMIT 10"

# free space when the org has hit the 1000 MB accumulation limit
sf data query --use-tooling-api --target-org vf-dev --query "SELECT Id FROM ApexLog LIMIT 200"
```

`[unverified]` `ApexLog.Status` and `ApexLog.StartTime` appear in Developer Console columns and are
widely used in queries but were not enumerated on the fetched `ApexLog` field table; if a query
rejects them, drop them and use `Operation`, `LogLength`, `DurationMilliseconds`, and `LogUserId`.

## 7. Log structure

| Section | Content |
| --- | --- |
| Header | API version used during the transaction, then the log categories and levels |
| Execution units | `EXECUTION_STARTED` ... `EXECUTION_FINISHED`; one execution unit equals one transaction |
| Code units | `CODE_UNIT_STARTED` ... `CODE_UNIT_FINISHED`; discrete units of work, nestable |
| Log lines | pipe-delimited events inside code units |
| Cumulative resource usage | logged at the end of many code units |
| Cumulative profiling | logged once at the end of the transaction: DML invocations, expensive queries |
| Heap usage | accurate when a heap error occurs; otherwise the largest size calculated during the transaction, reported as `0` when minimal |

Example header:

```text
68.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO;CALLOUT,INFO;DB,INFO;SYSTEM,DEBUG;VALIDATION,INFO;VISUALFORCE,INFO;
WORKFLOW,INFO
```

Example nesting:

```text
EXECUTION_STARTED
CODE_UNIT_STARTED|[EXTERNAL]execute_anonymous_apex
CODE_UNIT_STARTED|[EXTERNAL]MyTrigger on Account trigger event BeforeInsert for [new]|__sfdc_trigger/MyTrigger
CODE_UNIT_FINISHED      <-- trigger ends
CODE_UNIT_FINISHED      <-- executeAnonymous ends
EXECUTION_FINISHED
```

Code units include (not exhaustively): triggers; workflow invocations and time-based workflow;
validation rules; approval processes; Apex lead convert; `@future` method invocations; web service
invocations; `executeAnonymous` calls; Visualforce property access and actions on Apex controllers;
batch Apex `start` and `finish` plus each `execute`; `System.Schedule` `execute`; incoming email
handling. A class is **not** a discrete unit of code.

The debug log does not include information from actions triggered by time-based workflows, nor from
standard or custom controllers used in Visualforce email templates.

## 8. Log line anatomy

```text
16:06:58.49 (49590539)|USER_DEBUG|[1]|DEBUG|Hello World!
15:51:01.071 (55856000)|DML_BEGIN|[5]|Op:Insert|Type:Invoice_Statement__c|Rows:1
```

| Part | Meaning |
| --- | --- |
| `16:06:58.49` | time in the user's time zone, `HH:mm:ss.SSS` |
| `(49590539)` | nanoseconds elapsed since the start of the request; hidden in the Developer Console Execution Log view, visible in Raw Log |
| `USER_DEBUG` | event identifier |
| `[1]` | line number, or `[EXTERNAL]` for built-in Apex or managed-package code |
| remaining fields | event-specific: logging level, message, operation, object type, row count |

For `CODE_UNIT_STARTED`, `CODE_UNIT_FINISHED`, `VF_APEX_CALL_START`, `VF_APEX_CALL_END`,
`CONSTRUCTOR_ENTRY`, and `CONSTRUCTOR_EXIT`, the identifier ends with a pipe and a `typeRef`:
`__sfdc_trigger/YourTriggerName` or `__sfdc_trigger/YourNamespace/YourTriggerName` for triggers, and
`YourClass`, `YourClass$YourInnerClass`, or `YourNamespace/YourClass$YourInnerClass` for classes.

Session Ids are replaced with `SESSION_ID_REMOVED` in Apex debug logs. Nothing else is redacted.

## 9. Event table (the events worth knowing)

| Event | Fields logged | Category | Level |
| --- | --- | --- | --- |
| `EXECUTION_STARTED` / `EXECUTION_FINISHED` | none | Apex Code | ERROR and above |
| `CODE_UNIT_STARTED` / `CODE_UNIT_FINISHED` | line number, code unit name, `typeRef` | Apex Code | ERROR and above |
| `FATAL_ERROR` | exception type, message, stack trace | Apex Code | ERROR and above |
| `EXCEPTION_THROWN` | line number, exception type, message | Apex Code | INFO and above |
| `USER_DEBUG` | line number, logging level, user string | Apex Code | DEBUG and above by default; at the level passed to `System.debug` if specified |
| `METHOD_ENTRY` / `METHOD_EXIT` | line number, class Id, method signature | Apex Code | FINE and above |
| `CONSTRUCTOR_ENTRY` / `CONSTRUCTOR_EXIT` | line number, class Id, `<init>()` with parameter types, `typeRef` | Apex Code | FINE and above |
| `STATEMENT_EXECUTE` | line number | Apex Code | FINER and above |
| `HEAP_ALLOCATE` / `HEAP_DEALLOCATE` | line number, bytes | Apex Code | FINER and above |
| `BULK_HEAP_ALLOCATE` | bytes allocated | Apex Code | FINEST |
| `VARIABLE_ASSIGNMENT` | line number, variable name, string form of the value, address | Apex Code | FINEST |
| `VARIABLE_SCOPE_BEGIN` / `VARIABLE_SCOPE_END` | line number, name, type, referenceable flag, static flag | Apex Code | FINEST |
| `EMAIL_QUEUE` | line number | Apex Code | INFO and above |
| `SOQL_EXECUTE_BEGIN` | line number, number of aggregations, query source | DB | INFO and above |
| `SOQL_EXECUTE_END` | line number, number of rows, duration in ms | DB | INFO and above |
| `SOQL_EXECUTE_EXPLAIN` | query plan details for the executed query | DB | FINEST |
| `SOSL_EXECUTE_BEGIN` / `SOSL_EXECUTE_END` | line number, query source / rows and duration | DB | INFO and above |
| `DML_BEGIN` | line number, operation, record name or type, rows passed in | DB | INFO and above |
| `DML_END` | line number | DB | INFO and above |
| `QUERY_MORE_BEGIN` / `QUERY_MORE_END` / `QUERY_MORE_ITERATIONS` | line number, iteration count | DB | INFO and above |
| `SAVEPOINT_SET` / `SAVEPOINT_ROLLBACK` | line number, savepoint name | DB | INFO and above |
| `CUMULATIVE_LIMIT_USAGE` / `CUMULATIVE_LIMIT_USAGE_END` | none | Apex Profiling | INFO and above |
| `LIMIT_USAGE_FOR_NS` | namespace and the limit table (see below) | Apex Profiling | FINEST |
| `CUMULATIVE_PROFILING` / `CUMULATIVE_PROFILING_BEGIN` / `CUMULATIVE_PROFILING_END` | none | Apex Profiling | FINE and above |
| `STACK_FRAME_VARIABLE_LIST` | frame number and variable list | Apex Profiling | FINE and above |
| `STATIC_VARIABLE_LIST` | variable list | Apex Profiling | FINE and above |
| `TOTAL_EMAIL_RECIPIENTS_QUEUED` | number of emails sent | Apex Profiling | FINE and above |
| `TESTING_LIMITS` | none | Apex Profiling | INFO and above |
| `CALLOUT_REQUEST` | line number and request headers (external endpoint and method for Salesforce Connect adapters) | Callout | INFO and above |
| `CALLOUT_RESPONSE` | line number and response body (status and status code for Salesforce Connect adapters) | Callout | INFO and above |
| `SYSTEM_METHOD_ENTRY` / `SYSTEM_METHOD_EXIT` | line number and method signature | System | FINE and above |
| `SYSTEM_CONSTRUCTOR_ENTRY` / `SYSTEM_CONSTRUCTOR_EXIT` | line number, `<init>()` with parameter types | System | FINE and above |
| `SYSTEM_MODE_ENTER` / `SYSTEM_MODE_EXIT` | mode name | System | INFO and above |
| `ENTERING_MANAGED_PKG` | namespace | Apex Code | INFO and above |
| `IDEAS_QUERY_EXECUTE` | line number | DB | FINEST |
| `PUSH_TRACE_FLAGS`, `PUSH_NOTIFICATION_*` | notification diagnostics | Apex Code | varies |
| `SLA_PROCESS_CASE`, `SLA_EVAL_MILESTONE`, `SLA_END`, `SLA_NULL_START_DATE` | entitlement/milestone processing | Workflow | INFO and above |

### Flow events

| Event | Fields logged | Category | Level |
| --- | --- | --- | --- |
| `FLOW_CREATE_INTERVIEW_BEGIN` / `_END` / `_ERROR` | interview lifecycle | Workflow | varies |
| `FLOW_START_INTERVIEW_BEGIN` / `_END`, `FLOW_START_INTERVIEWS_BEGIN` / `_END` / `_ERROR` | interview start | Workflow | varies |
| `FLOW_ELEMENT_BEGIN` / `FLOW_ELEMENT_END` / `FLOW_ELEMENT_DEFERRED` | element execution | Workflow | varies |
| `FLOW_ELEMENT_ERROR` | message, element type, element name (flow runtime exception, designer exception, designer limit exceeded, designer runtime exception, spark not found) | Workflow | ERROR and above |
| `FLOW_ELEMENT_FAULT` | fault-path transition | Workflow | varies |
| `FLOW_ELEMENT_LIMIT_USAGE`, `FLOW_BULK_ELEMENT_LIMIT_USAGE`, `FLOW_START_INTERVIEW_LIMIT_USAGE`, `FLOW_INTERVIEW_FINISHED_LIMIT_USAGE` | limits consumed by the Flow | Workflow | varies |
| `FLOW_BULK_ELEMENT_BEGIN` / `_DETAIL` / `_END` / `_NOT_SUPPORTED` | bulk element processing | Workflow | varies |
| `FLOW_ASSIGNMENT_DETAIL`, `FLOW_VALUE_ASSIGNMENT` | variable writes | Workflow | varies |
| `FLOW_RULE_DETAIL`, `FLOW_LOOP_DETAIL`, `FLOW_SUBFLOW_DETAIL`, `FLOW_ACTIONCALL_DETAIL` | decision, loop, subflow, and action details | Workflow | varies |
| `FLOW_INTERVIEW_PAUSED` / `FLOW_INTERVIEW_RESUMED`, `FLOW_WAIT_*` | pause and wait handling | Workflow | varies |
| `FLOW_START_SCHEDULED_RECORDS` | scheduled-path records | Workflow | varies |

## 10. `LIMIT_USAGE_FOR_NS` contents

Namespace plus these counters:

Number of SOQL queries, number of query rows, number of SOSL queries, number of DML statements,
number of DML rows, number of code statements, maximum heap size, number of callouts, number of
Email Invocations, number of fields describes, number of record type describes, number of child
relationships describes, number of picklist describes, number of future calls, number of find
similar calls, number of `System.runAs()` invocations.

`CUMULATIVE_LIMIT_USAGE` prints a compact version showing each counter against its ceiling:

```text
16:06:58.49 (49590539)|CUMULATIVE_LIMIT_USAGE
16:06:58.49 (49590539)|LIMIT_USAGE_FOR_NS|(default)|
  Number of SOQL queries: 0 out of 100
  Number of query rows: 0 out of 50000
  Number of SOSL queries: 0 out of 20
  Number of DML statements: 0 out of 150
  Number of DML rows: 0 out of 10000
  Maximum CPU time: 0 out of 10000
  Maximum heap size: 0 out of 10000000
  Number of callouts: 0 out of 100
  Number of Email Invocations: 0 out of 10
  Number of future calls: 0 out of 50
  Number of queueable jobs added to the queue: 0 out of 50
  Number of Mobile Apex push calls: 0 out of 10
16:06:58.49 (49590539)|CUMULATIVE_LIMIT_USAGE_END
```

Interpret the ceilings against the current limits documentation rather than the numbers in this
sample: they come from a documentation example and vary by context (synchronous versus asynchronous).
Limit semantics: skill `sf-governor-limits`.

## 11. CLI flags

### `sf apex list log`

| Flag | Short | Notes |
| --- | --- | --- |
| `--target-org` | `-o` | required in practice; vibe-force always passes it explicitly |
| `--api-version` | | override the API version of the request |
| `--json` | | machine-readable |

### `sf apex get log`

| Flag | Short | Notes |
| --- | --- | --- |
| `--log-id` | `-i` | specific log |
| `--number` | `-n` | the N most recent logs |
| `--output-dir` | `-d` | write logs to files in this directory |
| `--target-org` | `-o` | org |
| `--api-version` | | |
| `--json` | | |

### `sf apex tail log`

| Flag | Short | Notes |
| --- | --- | --- |
| `--color` | `-c` | colourise the stream |
| `--debug-level` | `-d` | `DeveloperName` of a `DebugLevel` to use |
| `--skip-trace-flag` | `-s` | do not create or update a trace flag; stream with whatever is configured |
| `--target-org` | `-o` | org |
| `--api-version` | | |

### `sf apex run`

| Flag | Short | Notes |
| --- | --- | --- |
| `--file` | `-f` | file containing the anonymous Apex; omit to read from stdin |
| `--target-org` | `-o` | org |
| `--api-version` | | |
| `--json` | | |

### `sf apex run test` (relevant to log volume)

`--test-level` accepts `RunLocalTests`, `RunAllTestsInOrg`, `RunSpecifiedTests`; `--synchronous`
(`-y`) runs in one transaction so there is a single log; `--code-coverage` (`-c`) with
`--result-format` (`human`, `tap`, `junit`, `json`) and `--detailed-coverage` (`-v`) produce coverage
detail. `RunSpecifiedTests` requires 75% coverage per class and trigger in the deployment package,
computed individually. Test execution policy: skill `sf-apex-testing`.

### `sf data create record` / `sf data delete record` against Tooling API objects

| Flag | Short | Notes |
| --- | --- | --- |
| `--use-tooling-api` | `-t` | required for `TraceFlag`, `DebugLevel`, `ApexLog` |
| `--sobject` | `-s` | API name of the object |
| `--values` | `-v` | space-separated `Field=Value` pairs; quote values containing spaces |
| `--record-id` | `-i` | for delete/update |
| `--target-org` | `-o` | org |

Documented example:

```bash
sf data create record --use-tooling-api --sobject TraceFlag \
  --values "DebugLevelId=7dl170000008U36AAE StartDate=2022-12-15T00:26:04.000+0000 ExpirationDate=2022-12-15T00:56:04.000+0000 LogType=CLASS_TRACING TracedEntityId=01p17000000R6bLAAS"
```

## 12. Cleanup

```bash
# list active trace flags
sf data query --use-tooling-api --target-org vf-dev \
  --query "SELECT Id, LogType, TracedEntityId, DebugLevelId, StartDate, ExpirationDate FROM TraceFlag"

# delete one
sf data delete record --use-tooling-api --target-org vf-dev --sobject TraceFlag --record-id 7tf...
```

Always delete trace flags when a debugging session ends. Leaving them active risks the 1000 MB
window, slows deployments, and keeps PII flowing into logs administrators can read for seven days.
