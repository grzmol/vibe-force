# Governor limit remediation playbook

Symptom, real cause, minimum fix. Work top to bottom: the first fix that holds is the right one.
Runtime message strings are the ones the platform emits; they are not quoted from the developer
guide `[unverified]`, so match on the limit rather than on the exact wording.

## Triage order

1. **Read the limit, not the stack trace.** The exception names the limit that blew. That is the
   only fact you need to pick a row below.
2. **Find the multiplier.** Nearly every limit failure is a per-record operation that should have
   been a per-collection operation. Ask: what grows when the input grows?
3. **Fix the shape, not the number.** Raising a batch scope or splitting a method is a workaround.
   Moving the query out of the loop is a fix.
4. **Prove it with a constant.** A test that asserts a fixed query or DML count for a 200-record
   input is the only proof the fix holds at volume.

## SOQL queries: 101

| | |
| --- | --- |
| **Limit** | 100 synchronous, 200 asynchronous |
| **Usual cause** | A query inside a `for` loop, or a trigger handler called once per record |
| **Fix** | Collect ids first, one query with `WHERE Id IN :ids`, results into a `Map<Id, ...>` |
| **Also check** | `Database.query`, `Database.countQuery`, `Database.getQueryLocator` called in helper methods; each counts |
| **Free pass** | Custom metadata types have unlimited SOQL per transaction - move config lookups there |
| **Detected by** | Code Analyzer SOQL-in-loop rules; `vf-check analyzer` |

Parent-child subqueries count as extra queries with their own ceiling of 3x the top-level number
(`Limits.getLimitAggregateQueries()`). A `SELECT Id, (SELECT Id FROM Contacts) FROM Account` costs
more than it looks.

## SOQL rows: 50,001

| | |
| --- | --- |
| **Limit** | 50,000 records retrieved by SOQL, sync and async alike |
| **Usual cause** | An unfiltered or weakly filtered query on a large object |
| **Fix** | Narrow the `WHERE` clause, add a selective indexed filter, or move to Batch Apex where `Database.QueryLocator` returns up to 50 million |
| **Also check** | Row counts from relationship subqueries contribute to the total |
| **Related skill** | `sf-soql-sosl-optimization` for selectivity and indexes |

## DML statements: 151

| | |
| --- | --- |
| **Limit** | 150, sync and async alike |
| **Usual cause** | `insert`/`update` inside a loop |
| **Fix** | Build a list, one DML after the loop, guarded by `if (!list.isEmpty())` |
| **Also check** | `Approval.process`, `System.runAs`, `Database.setSavePoint`, `Database.rollback`, `Database.convertLead`, `Database.emptyRecycleBin` and publish-after-commit `EventBus.publish` all count |
| **Detected by** | Code Analyzer DML-in-loop rules; `vf-check analyzer` |

An empty-list DML still costs one statement. Guard it.

## DML rows: 10,001

| | |
| --- | --- |
| **Limit** | 10,000 records processed |
| **Usual cause** | One transaction trying to own an entire data migration |
| **Fix** | Batch Apex - the per-transaction limits reset for every `execute` call. Or load outside Apex entirely with Bulk API 2.0 (skill `sf-data-management`) |

## Heap size: 6 MB / 12 MB

| | |
| --- | --- |
| **Limit** | 6 MB synchronous, 12 MB asynchronous, 50 MB for email services |
| **Usual cause** | A `List<SObject>` holding every record with every field, or a large HTTP response |
| **Fix 1** | `SELECT` only the fields you use. Cheapest fix available |
| **Fix 2** | A SOQL for loop - the list form hands you 200 records at a time and lets the previous chunk be collected |
| **Fix 3** | Null out big references once you are done with them so they become collectable |
| **Fix 4** | Move to async for the 12 MB ceiling, or Batch Apex for a fresh heap per execution |
| **Also check** | HTTP request and response bodies count toward heap: 6 MB sync, 12 MB async max callout size |

## CPU time: 10,000 ms / 60,000 ms

| | |
| --- | --- |
| **Limit** | 10,000 ms synchronous, 60,000 ms asynchronous |
| **Usual cause** | Nested loops over two collections, repeated string concatenation, regex over large text, or describe calls in a loop |
| **Fix** | Replace the nested loop with a `Map` lookup built once. This is an algorithmic fix, not a bulkification fix |
| **Does not help** | Splitting one method into three. CPU is counted for the whole transaction |
| **Remember** | Database time for SOQL, SOSL and DML does **not** count. Callout waiting time does **not** count. Application-server CPU spent inside DML does count |

CPU time is the limit bulkification alone does not solve. If you bulkified and still blow CPU, the
shape of the algorithm is the problem.

## Callouts: 101, or 120 s cumulative

| | |
| --- | --- |
| **Limit** | 100 callouts, 120 s cumulative timeout, 10 s default timeout each |
| **Usual cause** | A callout per record |
| **Fix** | A composite or bulk endpoint on the remote side, or queue the work with a queueable per chunk |
| **Also check** | Request and response sizes count toward heap; max 6 MB sync, 12 MB async |
| **Related skill** | `sf-integration-patterns` for retry, composite and continuation patterns |

## `@future` calls and queueable jobs

| | |
| --- | --- |
| **Limits** | 50 `@future` per invocation; `System.enqueueJob` 50 sync, **1** async |
| **Usual cause** | Chaining from batch or future context where the queueable limit drops to 1 |
| **Fix** | Chain exactly one job per execution, or use the flex queue and Batch Apex |
| **Note** | In a queueable context, 50 `@future` methods are allowed; in batch and future contexts, 0 |

## Stack depth: 16

| | |
| --- | --- |
| **Limit** | 16 for recursion that fires triggers via insert, update or delete |
| **Usual cause** | A trigger updating its own object with no re-entry guard |
| **Fix** | A static `Set<Id>` of processed record ids, or the bypass mechanism in skill `sf-fflib-operations` |
| **Note** | Recursion that does not fire triggers lives in a single invocation and is not subject to this |

## Async executions per 24 hours

| | |
| --- | --- |
| **Limit** | 250,000 or licences x 200, whichever is greater, shared across batch, queueable, scheduled and future |
| **Symptom** | `AsyncApexExecutions Limit exceeded` when `Database.executeBatch` is called |
| **Cause** | A batch job whose total executions exceed the remaining rolling-window allowance. Batch Apex pre-checks capacity and refuses to start rather than failing halfway |
| **Fix** | Increase the batch scope so fewer executions cover the same rows, or schedule the job outside the window where other jobs run |
| **Check** | `sf org list limits --target-org <alias>`, or `OrgLimits.getMap().get('DailyAsyncApexExecutions')` |

## Concurrent long-running transactions

| | |
| --- | --- |
| **Limit** | Licences / 100, floor 10, cap 50. Applies to synchronous transactions over 5 seconds |
| **Symptom** | Requests denied under load while each one individually succeeds |
| **Fix** | Get the transaction under 5 seconds, or move the work async |
| **Note** | HTTP callout processing time is not counted toward the 5 seconds |

## Batch job concurrency

| | |
| --- | --- |
| **Limits** | 5 batch jobs queued or active concurrently; 100 in the flex queue in Holding; 1 concurrent `start` execution; 5 batch jobs submitted in a running test |
| **Symptom** | A job sits in Holding, or a test fails submitting a sixth batch |
| **Fix** | Chain jobs from `finish` instead of firing them in parallel; in tests, submit at most 5 |

## Apex code size

| | |
| --- | --- |
| **Limits** | 1 million characters per class or trigger; 6 MB of Apex per org (10 MB in scratch orgs); 65,535 bytecode instructions per method; 7,500 code units per deployment |
| **Symptom** | A deploy fails on org code size, or a method throws at execution time |
| **Fix** | `@IsTest` classes do not count toward the 6 MB org total, and managed package code does not either. Delete dead code first; a support case can raise the 6 MB default |

## Test-only limits

| | |
| --- | --- |
| **`MAX_DML_ROWS`** | 450,000 rows inserted, updated or deleted in one synchronous test execution context. Message: `Your runallTests is consuming too many DB resources` |
| **Fix** | Build fewer records. A test proving bulk safety needs 200 records, not 20,000 |
| **Test class queue** | The greater of 500, or 10x (production) / 20x (sandbox, Developer Edition) the number of test classes, per 24 hours |

## Managed packages

Before refactoring your own code because a limit blew in a transaction involving managed code,
establish which kind of package it is:

| Package kind | Limit behaviour |
| --- | --- |
| Certified managed (passed AppExchange security review) | Own copy of most per-transaction limits, plus a cumulative cross-namespace cap of 11x per-namespace |
| Non-certified | No separate limits; its usage counts against yours |
| Either | Heap, CPU time, transaction execution time and unique namespace count are shared across the whole transaction |

## Where to look in a debug log

Set `APEX_CODE` to `FINEST` and `SYSTEM` to at least `FINE`, then read:

| Marker | Tells you |
| --- | --- |
| `LIMIT_USAGE_FOR_NS` | Final per-namespace consumption for the transaction. The authoritative number |
| `CUMULATIVE_LIMIT_USAGE` | The block that wraps the above |
| `SOQL_EXECUTE_BEGIN` / `_END` | Each query, its row count, and where it was issued |
| `DML_BEGIN` / `DML_END` | Each DML statement and its row count |
| `CODE_UNIT_STARTED` | Which trigger or class opened the unit that is burning the budget |

Commands and log-level setup: skill `sf-debugging-logs`.
