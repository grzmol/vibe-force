# Log Analysis Playbook

Symptom, the exact log lines to find, and the conclusion they support. Every excerpt uses the
documented log-line format (`timestamp (elapsed_ns)|EVENT|[line]|fields`). Event names, categories,
and levels are from `references/debug-log-reference.md`.

## How to work

```bash
# capture a fresh log for the reproduction
sf apex get log --number 1 --output-dir .vibeforce/reports/logs --target-org vf-dev
LOG=$(ls -t .vibeforce/reports/logs/*.log | head -1)

# orient: transaction boundaries and code unit nesting
grep -nE "EXECUTION_(STARTED|FINISHED)|CODE_UNIT_(STARTED|FINISHED)" "$LOG"

# the failure
grep -nE "FATAL_ERROR|EXCEPTION_THROWN" "$LOG"

# the cost
grep -n -A 20 "LIMIT_USAGE_FOR_NS" "$LOG"
grep -nE "SOQL_EXECUTE_(BEGIN|END)|DML_(BEGIN|END)" "$LOG"
```

Read the elapsed nanoseconds in parentheses, not the wall clock: the delta between two adjacent
lines is where the time went.

---

## 1. `Apex CPU time limit exceeded`

**Find**

```text
09:14:02.3 (3012884)|CODE_UNIT_STARTED|[EXTERNAL]|01q...|OrderTrigger on Order trigger event AfterUpdate for [a01...]|__sfdc_trigger/OrderTrigger
09:14:02.3 (18022119)|SOQL_EXECUTE_BEGIN|[42]|Aggregations:0|SELECT Id, Amount FROM OrderItem WHERE OrderId = :orderId
09:14:02.3 (24188442)|SOQL_EXECUTE_END|[42]|Rows:12
...  (repeats 200 times, elapsed climbing by ~6ms each)
09:14:11.9 (9912447221)|CUMULATIVE_LIMIT_USAGE
09:14:11.9 (9912447221)|LIMIT_USAGE_FOR_NS|(default)|
  Number of SOQL queries: 201 out of 100
  Maximum CPU time: 10149 out of 10000
09:14:11.9 (9913001004)|FATAL_ERROR|System.LimitException: Apex CPU time limit exceeded
```

**Conclude** A query (or DML, or a describe) is executing once per record. Two signals prove it: the
repeated `SOQL_EXECUTE_BEGIN` at the same line number, and the SOQL count exceeding its ceiling.

**Next** Move the query outside the loop and key results by Id; see skill `sf-governor-limits` and
`sf-soql-sosl-optimization`. The static analyzer catches most instances before runtime:
`pmd:OperationWithLimitsInLoop`, `sfge:AvoidDatabaseOperationInLoop`.

**When the loop is not the cause** CPU time with a flat query count points at in-memory work.
`APEX_CODE=FINER` adds `STATEMENT_EXECUTE` and `HEAP_ALLOCATE` lines; look for the code unit whose
elapsed delta dominates, then for repeated `METHOD_ENTRY` of the same method (`APEX_CODE=FINE`).
Common culprits: nested loops over collections, `JSON.serialize`/`deserialize` of large graphs,
string concatenation in a loop, `Schema.getGlobalDescribe()` per iteration
(`sfge:AvoidMultipleMassSchemaLookups`). Callout wait time does not count toward CPU time.

---

## 2. `Apex heap size too large`

**Find**

```text
10:02:11.4 (4102331)|HEAP_ALLOCATE|[17]|Bytes:1048576
10:02:11.4 (4511002)|HEAP_ALLOCATE|[17]|Bytes:1048576
...
10:02:14.8 (3401122998)|LIMIT_USAGE_FOR_NS|(default)|
  Number of query rows: 48211 out of 50000
  Maximum heap size: 6291456 out of 6000000
10:02:14.8 (3401550210)|FATAL_ERROR|System.LimitException: Apex heap size too large: 6291456
```

**Conclude** The transaction is holding too many records or too large a structure. `Number of query
rows` close to its ceiling alongside the heap error means a query returned everything.

**Next** Requires `APEX_CODE=FINER` for `HEAP_ALLOCATE` lines; the line number identifies the
allocation site. Fix by narrowing the `SELECT` field list, adding a `WHERE` clause and `LIMIT`,
iterating with a SOQL for-loop (which chunks 200 records at a time), or moving to Batch Apex or
cursors for genuinely large volumes (skill `sf-async-apex-patterns`). Note the log reports the
largest heap size calculated during the transaction; small transactions report `0`.

---

## 3. Too many SOQL queries: 101

**Find**

```text
grep -c "SOQL_EXECUTE_BEGIN" "$LOG"     # 101
grep -n "SOQL_EXECUTE_BEGIN" "$LOG" | awk -F'|' '{print $3}' | sort | uniq -c | sort -rn
```

**Conclude** The `uniq -c` output names the offending line number and its count in one step. If the
counts are spread evenly across many line numbers, the transaction is chaining too much work
(trigger -> Flow -> trigger); look at `CODE_UNIT_STARTED` nesting to see how many automations ran.

**Next** If `FLOW_*` units appear between your Apex units, a Flow is consuming your query budget -
consolidate automation per object (skill `sf-flow-automation`).

---

## 4. A trigger appears not to run

**Find**

```text
grep -n "__sfdc_trigger/" "$LOG"
```

**Conclude**

| Observation | Conclusion |
| --- | --- |
| no `__sfdc_trigger/YourTrigger` line at all | the trigger did not fire: wrong event, inactive trigger, or the DML never happened |
| the line exists but no inner events | the trigger fired and returned early; check the guard conditions |
| the line appears twice for one DML | recursion; add a static guard (skill `sf-apex-development`) |
| `CODE_UNIT_STARTED` for the trigger with `Rows:0` on the preceding `DML_BEGIN` | nothing was passed to DML |

Remember the log may be truncated: a 20 MB log drops older lines from anywhere in the file, so
absence of a line is not proof when `LogLength` is at the ceiling. Re-run with fewer categories or
less data before concluding.

---

## 5. Field-level or object-level access failure

**Find**

```text
11:20:44.1 (140233111)|EXCEPTION_THROWN|[18]|System.QueryException: No such column 'Internal_Margin__c' on entity 'Expense__c'
```

or

```text
11:22:03.9 (99124411)|EXCEPTION_THROWN|[31]|System.SecurityException: Access to entity 'Expense__c' denied
```

**Conclude** The running user lacks FLS or object access and the operation runs in user mode (the
default at API 67.0 and later). This is the security model working, not a bug in the query.

**Next** Add the field or object to the feature permission set (skill `sf-security-model`,
`references/permission-architecture.md`), or handle it gracefully with
`Security.stripInaccessible`. Catch `QueryException` and call `getInaccessibleFields()` to log exactly
which fields the persona is missing - far faster than guessing from a permission matrix.

---

## 6. Slow query, correct results

**Find** with `DB=FINEST`:

```text
13:05:01.2 (203881)|SOQL_EXECUTE_BEGIN|[12]|Aggregations:0|SELECT Id FROM Case WHERE Subject LIKE '%urgent%'
13:05:01.2 (204122)|SOQL_EXECUTE_EXPLAIN|[12]|Cardinality: 1200000, sobjectCardinality: 1200000, relativeCost 2.8, sobjectType Case, leadingOperationType TableScan
13:05:04.7 (3512884220)|SOQL_EXECUTE_END|[12]|Rows:914|Duration:3502
```

**Conclude** `leadingOperationType TableScan` plus a `relativeCost` above 1.0 means the optimizer
found no usable index. A leading wildcard in `LIKE`, a negative filter (`!=`, `NOT IN`), or a
formula field in the `WHERE` clause all cause this.

**Next** Restructure the filter to hit an indexed field, or use SOSL for text search. Query Plan tool
usage: `references/debugging-tools.md`. Index and selectivity rules: skill
`sf-soql-sosl-optimization`. A null bind variable also degrades an indexed lookup into a scan, which
is precisely what `sfge:MissingNullCheckOnSoqlVariable` reports.

---

## 7. Batch job fails silently

**Find**

```bash
sf data query --target-org vf-dev --query "SELECT Id, ApexClass.Name, Status, JobItemsProcessed, TotalJobItems, NumberOfErrors, ExtendedStatus, ParentJobId FROM AsyncApexJob WHERE JobType IN ('BatchApex','BatchApexWorker') AND CreatedDate = TODAY ORDER BY CreatedDate DESC"
```

**Conclude**

| Reading | Conclusion |
| --- | --- |
| `Status = Completed`, `NumberOfErrors > 0` | some chunks failed; the whole chunk rolled back since a batch is transactional |
| `ExtendedStatus` populated | short description of the **first** error only; the rest was emailed to the last user who modified the batch class |
| `Status = Failed` | the job itself failed, often in `start` or in serialization of stateful members |
| `Status = Holding` | queued in the Apex flex queue, not yet started |
| several `BatchApexWorker` rows sharing a `ParentJobId` | chunked implementation; each child is a separate transaction and log |

**Next** Each chunk is its own transaction and produces its own log, so fetch several
(`sf apex get log --number 10 --output-dir ...`) and grep each for `FATAL_ERROR`. Stateful
`Database.SaveResult` members are a known hazard (`pmd:AvoidStatefulDatabaseResult`). Design fixes:
skill `sf-async-apex-patterns`.

---

## 8. Queueable disappears

**Find**

```text
grep -nE "CODE_UNIT_(STARTED|FINISHED)" "$LOG" | grep -i queueable
```

plus

```bash
sf data query --target-org vf-dev --query "SELECT Id, ApexClass.Name, Status, ExtendedStatus, NumberOfErrors FROM AsyncApexJob WHERE JobType = 'Queueable' AND CreatedDate = TODAY ORDER BY CreatedDate DESC LIMIT 20"
```

**Conclude** A Queueable that throws an unhandled exception leaves `Status = Failed` with a
truncated `ExtendedStatus` and no stack trace anywhere the caller can see. With a `Finalizer`
attached, the finalizer runs in its own transaction and can log the outcome, which is why
`pmd:QueueableWithoutFinalizer` exists.

**Next** Attach a `Finalizer` that records the result to a custom object or a platform event, then
query that instead of hunting logs. `Number of queueable jobs added to the queue` in
`LIMIT_USAGE_FOR_NS` tells you whether chaining hit the per-transaction ceiling.

---

## 9. Callout failure

**Find** with `CALLOUT=INFO`:

```text
14:31:02.1 (1020331)|CALLOUT_REQUEST|[57]|System.HttpRequest[Endpoint=callout:Example_API/v1/orders, Method=POST]
14:31:07.6 (5512884220)|CALLOUT_RESPONSE|[57]|System.HttpResponse[Status=Unauthorized, StatusCode=401]
```

**Conclude**

| Evidence | Cause |
| --- | --- |
| `401`/`403` on a `callout:` endpoint | External Credential principal not granted to the running user's permission set, or the secret was never set in this org |
| `System.CalloutException: Unauthorized endpoint` | Named Credential or Remote Site Setting missing for the endpoint |
| no `CALLOUT_REQUEST` at all | the code path never reached the callout, or `Callout` category is below `INFO` |
| `System.CalloutException: You have uncommitted work pending` | DML before the callout in the same transaction |
| timeout after ~120s | endpoint slow; set `req.setTimeout` and handle it |

**Next** Verify the credential wiring rather than the Apex. Probe the endpoint independently:

```bash
sf api request rest "/services/data/v67.0/limits" --target-org vf-dev
```

Named Credential and mock patterns: skills `sf-integration-patterns` and `sf-apex-testing`
(`HttpCalloutMock` is mandatory in tests: callouts are not permitted in test context).

---

## 10. Flow consumes the transaction

**Find**

```text
15:02:11.3 (410233)|CODE_UNIT_STARTED|[EXTERNAL]|Flow:Order_After_Save
15:02:11.3 (512884)|FLOW_ELEMENT_BEGIN|[]|FlowRecordLookup|Get_Order_Items
15:02:11.9 (612884220)|FLOW_BULK_ELEMENT_LIMIT_USAGE|[]|SOQL queries: 15 out of 100
15:02:12.1 (712884220)|FLOW_ELEMENT_ERROR|[]|The flow failed to access the value for ...|FlowRecordUpdate|Update_Order
```

**Conclude** `FLOW_*_LIMIT_USAGE` attributes limit consumption to the Flow, which shares the
transaction's budget with your Apex. `FLOW_ELEMENT_ERROR` names the element and the message;
`FLOW_ELEMENT_FAULT` shows the fault path being taken.

**Next** Requires `WORKFLOW` at `FINER` or higher. Consolidate per-object automation, add fault
paths, and prefer before-save updates. Skill `sf-flow-automation`.

---

## 11. Test passes locally, fails in the org

**Find** In the test run output, then the log for the failing method:

```bash
sf apex run test --tests ExpenseServiceTest.rejectsWithoutAccess --synchronous \
  --result-format human --target-org vf-dev
sf apex get log --number 1 --output-dir .vibeforce/reports/logs --target-org vf-dev
```

**Conclude**

| Log evidence | Cause |
| --- | --- |
| `System.QueryException` on a field the test never sets | org has data or metadata the scratch org does not; check `@IsTest(seeAllData=...)` absence and required fields |
| `EXCEPTION_THROWN` inside a `FLOW_*` unit | an active Flow in the target org interferes with the test's DML |
| `System.LimitException` only in the org | more triggers or Flows active than in the scratch org |
| assertion failure with different row counts | test relies on org data instead of `@TestSetup` |

**Next** Tests must create their own data and assert with messages
(`pmd:ApexUnitTestClassShouldHaveAsserts`, `pmd:ApexUnitTestShouldNotUseSeeAllDataTrue`). Skill
`sf-apex-testing`.

---

## 12. Deployment fails with test failures only in the target org

**Find** the deploy report, then the org's logs:

```bash
sf project deploy report --target-org vf-uat
sf apex get log --number 5 --output-dir .vibeforce/reports/logs --target-org vf-uat
```

**Conclude** Compare `CODE_UNIT_STARTED` lists between a passing org and the failing one: extra
triggers, Flows, or validation rules in the target explain most environment-specific failures.
Coverage failures are a different class: `RunSpecifiedTests` requires 75% per class and trigger
individually.

**Next** Validate before deploying (`vf-check deploy-validate`), and keep the scratch org definition
aligned with the target's features (skills `sf-deployment-strategies`, `sf-scratch-orgs-sandboxes`).

---

## 13. `System.debug` output missing

| Cause | Check | Fix |
| --- | --- | --- |
| `APEX_CODE` below `DEBUG` | log header line | raise the level, or pass `LoggingLevel.ERROR` to `System.debug` |
| explicit low level in the call | `System.debug(LoggingLevel.FINEST, ...)` with `APEX_CODE=DEBUG` | the event is logged at the level passed to the method; raise the category or the call level |
| log truncated at 20 MB | `ApexLog.LogLength` at the ceiling | narrow categories, reduce data volume |
| no trace flag and not a test | `SELECT Id FROM TraceFlag` returns nothing | create a `USER_DEBUG` trace flag |
| trace flags auto-disabled | you received an email about the 1000 MB window | wait 15 minutes, delete logs, re-enable |
| the code never ran | `CODE_UNIT_STARTED` absent | debug the call path, not the logging |

---

## 14. Grep cookbook

```bash
LOG=.vibeforce/reports/logs/latest.log

# every query with its row count and duration, in order
grep -nE "SOQL_EXECUTE_(BEGIN|END)" "$LOG"

# DML volume per object
grep "DML_BEGIN" "$LOG" | awk -F'|' '{print $4, $5, $6}' | sort | uniq -c | sort -rn

# hottest line numbers by repeated query execution
grep "SOQL_EXECUTE_BEGIN" "$LOG" | awk -F'|' '{print $3}' | sort | uniq -c | sort -rn | head

# which automations ran, in nesting order
grep -E "CODE_UNIT_(STARTED|FINISHED)" "$LOG" | sed -E 's/^[0-9:.]+ \([0-9]+\)\|//'

# the limit table
grep -A 20 "LIMIT_USAGE_FOR_NS" "$LOG"

# the expensive-operations summary emitted once per transaction
grep -A 30 "CUMULATIVE_PROFILING_BEGIN" "$LOG"

# exceptions with their line numbers
grep -nE "EXCEPTION_THROWN|FATAL_ERROR" "$LOG"

# Flow participation
grep -nE "FLOW_(ELEMENT_ERROR|ELEMENT_FAULT|.*LIMIT_USAGE)" "$LOG"

# callouts
grep -nE "CALLOUT_(REQUEST|RESPONSE)" "$LOG"
```

Use the built-in `grep` tool rather than shelling out when working inside the harness; the commands
above are the shape of the search, whichever tool issues it.

---

## 15. Decision table: which category and level to set

| Question | Minimum setting |
| --- | --- |
| Which automations ran? | `APEX_CODE=ERROR` (code units log at ERROR and above) |
| What did `System.debug` print? | `APEX_CODE=DEBUG` |
| Which queries and DML, with row counts? | `DB=INFO` |
| Why is this query slow? | `DB=FINEST` (`SOQL_EXECUTE_EXPLAIN`) |
| Which method is burning CPU? | `APEX_CODE=FINE` (`METHOD_ENTRY`/`METHOD_EXIT`) |
| Where is heap being allocated? | `APEX_CODE=FINER` (`HEAP_ALLOCATE`) |
| What were the limit totals? | `APEX_PROFILING=FINEST` (`LIMIT_USAGE_FOR_NS`) |
| What did the callout send and receive? | `CALLOUT=INFO` |
| What did the Flow do? | `WORKFLOW=FINER` |
| Which validation rule blocked the save? | `VALIDATION=INFO` |
| What is the value of every variable? | `APEX_CODE=FINEST` - last resort, PII risk, log-size risk |
