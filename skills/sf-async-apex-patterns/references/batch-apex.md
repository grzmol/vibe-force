# Batch Apex and Apex Cursors - Reference

Source of record: Apex Developer Guide, topics `apex_batch`, `apex_batch_interface`,
`apex_batch_platformevents`, `apex_cursors`, `apex_cursors_versus_batch`, `apex_scheduler`,
`apex_gov_limits`. URLs at the end of this file.

## 1. `Database.Batchable` lifecycle

| Method | Signature | Runs | Notes |
| --- | --- | --- | --- |
| `start` | `Database.QueryLocator \| Iterable<sObject> start(Database.BatchableContext bc)` | once, before any chunk | only one batch job's `start` runs at a time per org |
| `execute` | `void execute(Database.BatchableContext bc, List<P> scope)` | once per chunk | each call is a discrete transaction with fresh governor limits; chunk order is not guaranteed |
| `finish` | `void finish(Database.BatchableContext bc)` | once, after all chunks | use for notifications and for chaining the next job |

All three must be declared `public` or `global`.

`Database.BatchableContext`:

| Member | Returns | Purpose |
| --- | --- | --- |
| `getJobID()` | `Id` | the `AsyncApexJob` id; also accepted by `System.abortJob` |

## 2. `QueryLocator` versus `Iterable`

| Aspect | `Database.QueryLocator` | `Iterable<sObject>` |
| --- | --- | --- |
| SOQL row governor limit | bypassed for the driving query | still enforced (50,000 rows) |
| Maximum records | 50,000,000; the job terminates as `Failed` above that | bounded by the SOQL row limit |
| `scope` upper bound | 2,000; higher values are chunked down to 2,000 | no upper bound, but other limits apply |
| Implementation | fast chunked path, *provided the query has no relationship subquery* | slower non-chunking path |
| Child job records | `BatchApexWorker` children created under `ParentJobId` | no child jobs |

A relationship subquery in the locator forces the slow path:

```apex
// Slow, non-chunking
return Database.getQueryLocator('SELECT Id, (SELECT Id FROM Contacts) FROM Account');
```

```apex
// Fast, chunking; fetch children inside execute instead
public Database.QueryLocator start(Database.BatchableContext bc) {
    return Database.getQueryLocator('SELECT Id FROM Account', AccessLevel.USER_MODE);
}
public void execute(Database.BatchableContext bc, List<Account> scope) {
    Map<Id, Account> byId = new Map<Id, Account>(scope);
    List<Contact> children = [
        SELECT Id, AccountId FROM Contact WHERE AccountId IN :byId.keySet() WITH USER_MODE
    ];
}
```

Custom `Iterable` when the scope is not expressible as one SOQL statement:

```apex
public with sharing class BatchClass implements Database.Batchable<Account> {
    public Iterable<Account> start(Database.BatchableContext info) {
        return new CustomAccountIterable();
    }
    public void execute(Database.BatchableContext info, List<Account> scope) { /* ... */ }
    public void finish(Database.BatchableContext info) { }
}
```

## 3. Submitting a job

| Call | Notes |
| --- | --- |
| `Database.executeBatch(batchable)` | default chunk size 200 |
| `Database.executeBatch(batchable, scope)` | `scope > 0`; max 2,000 with a `QueryLocator` |
| `System.scheduleBatch(batchable, jobName, minutesFromNow)` | one-shot, no `Schedulable` class required |
| `System.scheduleBatch(batchable, jobName, minutesFromNow, scopeSize)` | one-shot with explicit chunk size |

Optimal `scope` values are factors of 2,000: 100, 200, 400, 500, 1000, 2000.

Outcome of `Database.executeBatch`:

- With the Apex flex queue enabled, the job is placed in the flex queue with status `Holding`.
- If the flex queue already holds 100 jobs, `Database.executeBatch` throws a `LimitException` and the
  job is not queued.
- Without the flex queue, the job goes straight to the batch job queue with status `Queued`; if five
  jobs are already queued or active, a `LimitException` is thrown.
- Parallel enqueue requests can push the flex queue briefly above 100; further attempts throw
  `LimitException` until the queue drains.

Reordering held jobs:

```apex
Boolean moved = System.FlexQueue.moveBeforeJob(jobToMoveId, jobInQueueId);
```

Other `System.FlexQueue` movers documented alongside: `moveAfterJob`, `moveJobToFront`,
`moveJobToEnd`, `moveJobToPosition`. Jobs otherwise run first-in first-out. Setup path: Setup ->
Apex Flex Queue.

## 4. Batch job statuses

| Status | Meaning |
| --- | --- |
| `Holding` | in the Apex flex queue, waiting for resources |
| `Queued` | awaiting execution |
| `Preparing` | `start` has been invoked; can last minutes |
| `Processing` | chunks are running |
| `Aborted` | aborted by a user or `System.abortJob` |
| `Completed` | finished, with or without failures (check `NumberOfErrors`) |
| `Failed` | job-level failure, for example a `QueryLocator` above 50 million rows |

## 5. State across chunks

```apex
public with sharing class SummarizeAccountTotal
        implements Database.Batchable<SObject>, Database.Stateful {
    public final String query;
    public Integer summary;

    public SummarizeAccountTotal(String q) {
        query = q;
        summary = 0;
    }

    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator(query, AccessLevel.USER_MODE);
    }

    public void execute(Database.BatchableContext bc, List<SObject> scope) {
        for (SObject record : scope) {
            summary += (Integer) record.get('Total__c');
        }
    }

    public void finish(Database.BatchableContext bc) {
        System.debug('Grand total: ' + summary);
    }
}
```

- With `Database.Stateful`: **instance** members retain values between transactions; **static**
  members are reset.
- Without `Database.Stateful`: all static and instance members are reset to their initial values at
  the start of each chunk.
- Scheduled Apex behaves differently: scheduled job objects and their members persist from
  `System.schedule()` into every subsequent run. Mark members `transient` to prevent that.

## 6. Batch Apex limits

| Limit | Value |
| --- | --- |
| Concurrently queued or active batch jobs | 5 |
| `Holding` jobs in the Apex flex queue | 100 |
| Batch jobs submittable in a running test | 5 |
| Batch method executions per rolling 24 hours | 250,000 or user licences x 200, whichever is greater (counts `start`, `execute`, and `finish`; shared with all async Apex) |
| Records returnable by `Database.QueryLocator` | 50,000,000 |
| Records retrieved by `Database.getQueryLocator` (per-transaction limit) | 10,000 |
| `scope` maximum with a `QueryLocator` | 2,000 |
| `scope` maximum with an `Iterable` | none enforced |
| Default chunk size when `scope` is omitted | 200 |
| Callouts per `start`, `execute`, or `finish` | 100 each |
| Concurrent `start` methods per org | 1 |
| `QueryLocator` result availability | 2 days, including nested query results |
| `FOR UPDATE` in the `start` query | not applicable to Batch Apex |

Preemptive capacity check: when `Database.executeBatch` is called and `start` has returned the
workload, Salesforce checks whether the whole job fits in the remaining 24-hour async capacity. If
not, `AsyncApexExecutions Limit exceeded` is thrown and the remaining allowance is untouched.

Licence types counting toward the daily async limit: full Salesforce, Salesforce Platform, App
Subscription, Chatter Only, Identity, and Company Communities users.

## 7. Considerations and best practices

- Calling `Database.executeBatch` only queues the job; actual start time depends on service
  availability and flex-queue priority.
- `@future` methods are not allowed in a class implementing `Database.Batchable`, and cannot be
  called from a batch class.
- Email notifications on completion go to the submitting user, or to the *Apex Exception Notification
  Recipient* when the code ships in a managed package.
- Every batch invocation creates an `AsyncApexJob` row. For every 10,000 `AsyncApexJob` rows Apex
  creates one extra row of type `BatchApexWorker`; filter it out with `JobType != 'BatchApexWorker'`.
- Batch chunks can re-run: jobs interrupted by service maintenance are rolled back and restarted.
  Any non-transactional operation inside `execute` (callouts, external writes, email) must be
  idempotent.
- Keep total batches low. If more than 2,000 unprocessed requests from one org sit in the async queue,
  additional requests from that org are delayed while the queue serves other orgs.
- Prefer chaining batch jobs over scheduling them at fixed intervals when runs could overlap.
- Row locking: requery inside `execute` with `FOR UPDATE`, selecting `Id` in the locator, so
  concurrent updates are not silently overwritten.
- Salesforce Connect / OData `QueryLocator` usage: enable *Request Row Counts* on the external data
  source, and prefer *Server-Driven Pagination*. With client-driven paging, records added during the
  run can be processed twice and deleted records can be skipped. With server-driven pagination the
  effective batch size is the smaller of the `scope` parameter and the external system's page size.
- Sharing recalculation batches should delete and re-create all Apex managed sharing for the records
  in the chunk.
- `System.Test.enqueueBatchJobs` and `System.Test.getFlexQueueOrder` enqueue and inspect no-operation
  jobs inside tests.

## 8. Chaining batch jobs

Available since API version 26.0. Call `Database.executeBatch` or `System.scheduleBatch` from
`finish`; the next job starts after the current one completes. Chaining enforces strict sequential
execution, which prevents two jobs from concurrently mutating the same records. If batch chunking is
not actually needed, prefer Queueable chaining, which does not consume batch slots.

```apex
public void finish(Database.BatchableContext bc) {
    AsyncApexJob job = [
        SELECT Status, NumberOfErrors FROM AsyncApexJob
        WHERE Id = :bc.getJobId() WITH USER_MODE
    ];
    if (job.NumberOfErrors == 0) {
        Database.executeBatch(new NextStageBatch(), 200);
    }
}
```

## 9. `BatchApexErrorEvent`

Available in API version 44.0 and later. When a batch Apex class implements
`Database.RaisesPlatformEvents` and an `execute` invocation hits an unhandled exception, Salesforce
publishes a `BatchApexErrorEvent` message. Subscribe with a trigger on `BatchApexErrorEvent` to mark
the failing records and drive a targeted retry instead of re-running the whole job.

```apex
public with sharing class ResilientBatch
        implements Database.Batchable<SObject>, Database.RaisesPlatformEvents {
    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator('SELECT Id FROM Account', AccessLevel.USER_MODE);
    }
    public void execute(Database.BatchableContext bc, List<Account> scope) { /* may throw */ }
    public void finish(Database.BatchableContext bc) { }
}
```

```apex
trigger MarkDirtyIfFail on BatchApexErrorEvent (after insert) {
    Set<Id> failedIds = new Set<Id>();
    for (BatchApexErrorEvent evt : Trigger.new) {
        for (String recordId : evt.JobScope.split(',')) {
            failedIds.add((Id) recordId);
        }
        System.debug(LoggingLevel.ERROR, evt.ExceptionType + ': ' + evt.Message);
    }
    // flag failedIds for reprocessing
}
```

Fields on the event: `AsyncApexJobId`, `JobScope` (record ids in scope for the failing `execute`, or
the `toString()` of the iterable objects when the job uses a custom iterator; max 40,000 characters),
`DoesExceedJobScopeMaxLength`, `ExceptionType` (internal platform errors appear as
`System.UnexpectedException`), `Message` (max 5,000 characters), `StackTrace` (max 5,000 characters),
`Phase` (`START`, `EXECUTE`, or `FINISH`), `RequestId`, `ReplayId`, and `EventUuid`. Subscription
channel is `/event/BatchApexErrorEvent`; only the platform can fire it, and read access requires
Customize Application. In a test, call `Test.getEventBus().deliver()` after `Test.stopTest()` so the
event trigger runs.

## 10. Cursors and Queueable versus Batch Apex

| Detail | Batch Apex | Cursors + Queueable |
| --- | --- | --- |
| Parallel batch slot usage | yes, counts against the 5-job limit | no |
| Flex queue contention | yes | no |
| Execution model | ordered and sequential with a fixed scope size | developer-defined order, sequence, and fetch size |
| Error isolation | per batch chunk | per queueable transaction, via a Transaction Finalizer |

Cursor mechanics:

| Item | Value |
| --- | --- |
| Creation | `Database.getCursor(query, accessLevel)` or `Database.getCursorWithBinds(...)` |
| Fetch | `Cursor.fetch(position, count)` - cursors are stateless, you track the offset |
| Size | `Cursor.getNumRecords()` |
| Max rows across all Apex cursors per transaction | 50,000,000 (same for sync and async) |
| Max `Cursor.fetch()` calls per transaction | 100 |
| Limit accounting | each `fetch` counts as a SOQL query and its rows count against the query-row limit |
| Exceptions | `System.TransientCursorException` (retryable), `System.FatalCursorException` (not retryable) |

Both Apex cursors and `Database.getQueryLocator()` fix the set of record ids at creation time.
Later updates that would remove a record from the `WHERE` clause, and later sharing-rule changes, do
not alter the result set.

Pagination cursors are a separate feature with their own limits: 100,000 rows across all Apex
pagination cursors per transaction, 50 pagination cursor instances per transaction, and 2,000 rows
per page.

## 11. Apex Scheduler quick reference

CRON format: `Seconds Minutes Hours Day_of_month Month Day_of_week Optional_year`.

| Field | Values | Special characters |
| --- | --- | --- |
| Seconds | 0-59 | none |
| Minutes | 0-59 | none |
| Hours | 0-23 | `, - * /` |
| Day_of_month | 1-31 | `, - * ? / L W` |
| Month | 1-12 or `JAN`-`DEC` | `, - * /` |
| Day_of_week | 1-7 or `SUN`-`SAT` | `, - * ? / L #` |
| optional_year | null or 1970-2099 | `, - * /` |

| Character | Meaning |
| --- | --- |
| `,` | value list, for example `JAN,MAR,APR` |
| `-` | range, for example `JAN-MAR` |
| `*` | all values |
| `?` | no specific value; only for `Day_of_month` and `Day_of_week` |
| `/` | increments; `1/5` in `Day_of_month` means every fifth day starting on the first |
| `L` | last; in `Day_of_month` the last day of the month, in `Day_of_week` alone it means `SAT`, and `2L` means the last Monday |
| `W` | nearest weekday; `20W` runs on the 19th when the 20th is a Saturday; `1W` moves forward to the 3rd |
| `#` | nth weekday of the month, `weekday#day_of_month`; `2#1` is the first Monday |

| Expression | Behaviour |
| --- | --- |
| `0 0 13 * * ?` | every day at 1 PM |
| `0 5 * * * ?` | every hour at 5 minutes past; Apex cannot be scheduled more than once an hour |
| `0 0 22 ? * 6L` | last Friday of every month at 10 PM |
| `0 0 10 ? * MON-FRI` | Monday to Friday at 10 AM |
| `0 0 20 * * ? 2010` | every day at 8 PM during 2010 |

Scheduler facts:

- `System.schedule(jobName, cronExpression, schedulable)` returns the `CronTrigger` id.
- Schedules use the scheduling user's time zone.
- The scheduler runs as system: all classes execute regardless of the user's ability to run them.
- 100 scheduled Apex jobs may exist at one time; count them with
  `SELECT COUNT() FROM CronTrigger WHERE CronJobDetail.JobType = '7'`.
- Synchronous governor limits apply to scheduled Apex even though it is asynchronous.
- Synchronous web-service callouts are not supported from scheduled Apex. Delegate to Queueable or
  Batch with `Database.AllowsCallouts`.
- Sandbox refresh does not copy scheduled jobs; reschedule them.
- Resuming a paused scheduled job runs it once immediately; missed executions are not replayed.
- Deploying a class with pending jobs fails with `This schedulable class has jobs pending or in
  progress - CronTrigger IDs (ids)`. Delete the job, deploy, recreate. The Deployment Settings page
  has a bypass, but the running job may then fail.
- `SchedulableContext.getTriggerId()` returns the `CronTrigger` id; pass it to `System.abortJob`.

## 12. Source URLs

- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_batch.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_batch_interface.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_batch_platformevents.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_cursors.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_cursors_versus_batch.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_scheduler.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm
- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/sforce_api_objects_batchapexerrorevent.htm
- PDF snapshot used while authoring: https://resources.docs.salesforce.com/264/latest/en-us/sfdc/pdf/salesforce_apex_developer_guide.pdf
