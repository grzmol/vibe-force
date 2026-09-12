# Async Job Monitoring, Abort, and Retry Runbooks - Reference

Everything here is queryable with `sf data query` or executable with `sf apex run`. Sources: Object
Reference for the Salesforce Platform (`AsyncApexJob`, `CronTrigger`, `CronJobDetail`,
`EventBusSubscriber`, `FlexQueueItem`), Apex Developer Guide (`apex_batch_interface`,
`apex_scheduler`), Salesforce CLI Command Reference. URLs at the end.

## 1. `AsyncApexJob`

Represents an Apex sharing recalculation job, a Batch Apex job, an `@future` method, or a job
implementing `Queueable` or `Schedulable`. Supported calls: `describeSObjects()`, `query()`,
`retrieve()`. When Apex is not running in system mode, the user needs **View Setup and
Configuration** to access this object and to enqueue async Apex.

| Field | Type | Notes |
| --- | --- | --- |
| `ApexClassId` | reference | lookup to `ApexClass`; relationship name `ApexClass` |
| `CompletedDate` | dateTime | when the job finished |
| `CronTriggerId` | reference | only for `ScheduledApex` jobs; API 53.0 and later |
| `ExtendedStatus` | string | short description of the **first** error; later errors are emailed to the last user who modified the batch class. API 19.0 and later |
| `JobItemsProcessed` | int | batches processed. Label *Batches Processed* |
| `JobType` | picklist | `ApexToken`, `BatchApex`, `BatchApexWorker`, `Future`, `Queueable`, `ScheduledApex`, `SharingRecalculation`, `TestRequest`, `TestWorker` |
| `LastProcessed` | string | last id processed and committed |
| `LastProcessedOffset` | int | offset of the last id processed and committed |
| `MethodName` | string | the Apex method executing. Label *Apex Method* |
| `NumberOfErrors` | int | number of **batches** with a failure; a batch is transactional so any unhandled exception fails the whole batch. Label *Failures* |
| `ParentJobId` | reference | for chunked batch jobs, the parent of a `BatchApexWorker` child |
| `Status` | picklist | `Holding`, `Queued`, `Preparing`, `Processing`, `Aborted`, `Completed`, `Failed` |
| `TotalJobItems` | int | total batches. Label *Total Batches* |

Queueable and future jobs do not process batches, so `JobItemsProcessed` and `TotalJobItems` are
always zero for them.

For every 10,000 `AsyncApexJob` rows, Apex creates one internal row of type `BatchApexWorker`. Always
filter it out when counting or listing jobs.

### Standard monitoring queries

```bash
# Recent async jobs, excluding internal worker rows
sf data query --target-org vf-dev --query "SELECT Id, JobType, ApexClass.Name, MethodName, Status, NumberOfErrors, JobItemsProcessed, TotalJobItems, ExtendedStatus, CreatedDate, CompletedDate FROM AsyncApexJob WHERE JobType != 'BatchApexWorker' ORDER BY CreatedDate DESC LIMIT 50"

# Anything still in flight
sf data query --target-org vf-dev --query "SELECT Id, JobType, ApexClass.Name, Status, CreatedDate FROM AsyncApexJob WHERE Status IN ('Holding','Queued','Preparing','Processing') AND JobType != 'BatchApexWorker' ORDER BY CreatedDate"

# Failures in the last day
sf data query --target-org vf-dev --query "SELECT Id, ApexClass.Name, Status, NumberOfErrors, ExtendedStatus FROM AsyncApexJob WHERE CreatedDate = LAST_N_DAYS:1 AND (NumberOfErrors > 0 OR Status IN ('Failed','Aborted')) AND JobType != 'BatchApexWorker'"

# Batch slot pressure: how many jobs occupy the 5 concurrent slots
sf data query --target-org vf-dev --query "SELECT COUNT(Id) FROM AsyncApexJob WHERE JobType = 'BatchApex' AND Status IN ('Queued','Preparing','Processing')"

# Flex queue depth against the 100-job ceiling
sf data query --target-org vf-dev --query "SELECT COUNT(Id) FROM AsyncApexJob WHERE Status = 'Holding'"

# Per-class failure profile over the last week
sf data query --target-org vf-dev --query "SELECT ApexClass.Name, JobType, COUNT(Id) jobs, SUM(NumberOfErrors) errs FROM AsyncApexJob WHERE CreatedDate = LAST_N_DAYS:7 AND JobType != 'BatchApexWorker' GROUP BY ApexClass.Name, JobType ORDER BY SUM(NumberOfErrors) DESC"

# Chunk detail for one parent batch job
sf data query --target-org vf-dev --query "SELECT Id, Status, NumberOfErrors, ExtendedStatus, LastProcessed FROM AsyncApexJob WHERE ParentJobId = '707XXXXXXXXXXXXXXX'"
```

From Apex, inside `finish`:

```apex
public void finish(Database.BatchableContext bc) {
    AsyncApexJob job = [
        SELECT Id, Status, NumberOfErrors, JobItemsProcessed, TotalJobItems,
               ExtendedStatus, CreatedBy.Email
        FROM AsyncApexJob
        WHERE Id = :bc.getJobId()
        WITH USER_MODE
    ];
    if (job.NumberOfErrors > 0) {
        Messaging.SingleEmailMessage mail = new Messaging.SingleEmailMessage();
        mail.setToAddresses(new String[]{ job.CreatedBy.Email });
        mail.setSubject('Batch ' + job.Status + ' with ' + job.NumberOfErrors + ' failures');
        mail.setPlainTextBody(job.ExtendedStatus);
        Messaging.sendEmail(new Messaging.SingleEmailMessage[]{ mail });
    }
}
```

## 2. `FlexQueueItem` and flex queue control

`FlexQueueItem` exposes the ordered contents of the Apex flex queue. UI path: Setup -> Apex Flex
Queue. Programmatic reordering uses `System.FlexQueue`:

```apex
Boolean ok = System.FlexQueue.moveBeforeJob(jobToMoveId, jobInQueueId);
```

Companion movers documented alongside: `moveAfterJob`, `moveJobToFront`, `moveJobToEnd`,
`moveJobToPosition`. Jobs without intervention run first-in first-out. When resources free up the
system promotes the top job from the flex queue into the batch job queue and its status changes from
`Holding` to `Queued`. Up to five queued or active jobs run simultaneously per org.

## 3. `CronTrigger` and `CronJobDetail`

| `CronTrigger` field | Notes |
| --- | --- |
| `CronExpression` | the scheduled CRON string |
| `CronJobDetailId` | lookup to `CronJobDetail` (relationship name `CronJobDetail`) |
| `StartTime`, `EndTime` | schedule window |
| `NextFireTime`, `PreviousFireTime` | next and last run |
| `OwnerId` | scheduling user |
| `State` | `WAITING`, `ACQUIRED`, `EXECUTING`, `COMPLETE`, `ERROR`, `DELETED`, `PAUSED`, `BLOCKED`, `PAUSED_BLOCKED` |
| `TimesTriggered` | number of runs so far |
| `TimeZoneSidKey` | schedule time zone |

`State` meanings worth knowing: `BLOCKED` means a second instance was attempted while the first is
still running and lasts until the first completes. `PAUSED` and `PAUSED_BLOCKED` appear during patch
and major releases and clear automatically afterwards.

| `CronJobDetail.JobType` | Job |
| --- | --- |
| `1` | Data Export |
| `3` | Dashboard Refresh |
| `4` | Reporting Snapshot |
| `6` | Scheduled Flow |
| `7` | Scheduled Apex |
| `8` | Report Run |
| `9` | Batch Job |
| `A` | Reporting Notification |

```bash
# Every scheduled Apex job with its schedule and next run
sf data query --target-org vf-dev --query "SELECT Id, CronJobDetail.Name, CronJobDetail.JobType, CronExpression, State, TimesTriggered, NextFireTime, PreviousFireTime, TimeZoneSidKey FROM CronTrigger WHERE CronJobDetail.JobType = '7' ORDER BY NextFireTime"

# Count scheduled Apex jobs against the 100-job ceiling
sf data query --target-org vf-dev --query "SELECT COUNT() FROM CronTrigger WHERE CronJobDetail.JobType = '7'"

# Scheduled flows
sf data query --target-org vf-dev --query "SELECT Id, CronJobDetail.Name, CronExpression, State, NextFireTime FROM CronTrigger WHERE CronJobDetail.JobType = '6'"
```

From Apex:

```apex
CronTrigger ct = [
    SELECT Id, CronExpression, TimesTriggered, NextFireTime, State
    FROM CronTrigger
    WHERE Id = :sc.getTriggerId()
    WITH USER_MODE
];
CronJobDetail detail = [
    SELECT Id, Name, JobType FROM CronJobDetail WHERE Id = :ct.CronJobDetailId WITH USER_MODE
];
```

## 4. `EventBusSubscriber`

Represents a trigger, process, or flow subscribed to a platform event or change event. Does **not**
include CometD or Pub/Sub API subscribers. Read-only, queryable only, internal users only (Summer '20
and later).

| Field | Notes |
| --- | --- |
| `Topic` | channel name: `MyEvent__e` for platform events, `AccountChangeEvent` for change events |
| `Name` | subscriber name |
| `Type` | `ApexTrigger`; blank for a process or flow Pause element |
| `Status` | `Running`, `Error`, `Suspended`, `Repartitioning` |
| `Retries` | retries caused by `EventBus.RetryableException`; Apex triggers only, API 43.0 and later |
| `Position` | replay id of the last event the subscriber processed (deprecated as of API 66.0 - use `LastProcessed`) |
| `LastProcessed` | replay id of the last processed event; replaces `Position` |
| `LastPublished` | replay id of the last published event; replaces `Tip` |
| `Tip` | deprecated as of API 66.0. Always `-1` for high-volume platform events and change events |
| `LastError` | last error message |
| `ExternalId` | subscriber external id |
| `IsPartitioned` | whether parallel subscriptions are configured |

`Status = Error` means the trigger exceeded the retry cap on `EventBus.RetryableException` and was
disconnected. Assertion failures and general unhandled exceptions do **not** cause the error state.
Recovery: fix and save the trigger (or redeploy the managed package); the subscription resumes from
the tip, starting with new events. Events published while the subscriber was in error are lost.

`Status = Suspended` means an admin or an internal error disconnected the subscriber. Resume from the
subscription detail page on the platform event page; for a process, deactivate then reactivate.

```bash
# Subscriber health for all events
sf data query --target-org vf-dev --query "SELECT Topic, Name, Type, Status, Retries, LastProcessed, LastPublished, LastError, IsPartitioned FROM EventBusSubscriber ORDER BY Topic"

# Only unhealthy subscribers
sf data query --target-org vf-dev --query "SELECT Topic, Name, Status, Retries, LastError FROM EventBusSubscriber WHERE Status != 'Running'"

# Lag: published position minus processed position
sf data query --target-org vf-dev --query "SELECT Topic, Name, LastPublished, LastProcessed FROM EventBusSubscriber WHERE Type = 'ApexTrigger'"
```

## 5. Org-level async capacity

The rolling 24-hour async limit and other org limits are not SOQL-visible; read them from the REST
`limits` resource.

```bash
# All org limits, including DailyAsyncApexExecutions
sf org list limits --target-org vf-dev

# Raw REST call when a specific key is needed
sf api request rest "/services/data/v67.0/limits" --target-org vf-dev
```

Keys relevant to async work: `DailyAsyncApexExecutions`, `DailyAsyncApexTests`,
`ConcurrentAsyncGetReportInstances`, `PublishCallbackUsageInApex`,
`PlatformEventTriggersWithParallelProcessing`, `DailyDeliveredPlatformEvents`.

## 6. Abort runbook

`System.abortJob(jobId)` accepts an `AsyncApexJob` id (batch, queueable, future) or a `CronTrigger`
id (scheduled Apex). It stops a job but does **not** roll back committed work.

```apex
// scripts/apex/abort-job.apex
System.abortJob('707XXXXXXXXXXXXXXX');
```

```bash
sf apex run --target-org vf-dev --file scripts/apex/abort-job.apex
```

Bulk abort of every in-flight batch job for one class:

```apex
// scripts/apex/abort-class-jobs.apex
for (AsyncApexJob job : [
    SELECT Id FROM AsyncApexJob
    WHERE ApexClass.Name = 'ArchiveClosedCasesBatch'
      AND Status IN ('Holding', 'Queued', 'Preparing', 'Processing')
    WITH SYSTEM_MODE
]) {
    System.abortJob(job.Id);
}
```

Unschedule a scheduled class before deploying it:

```apex
// scripts/apex/unschedule.apex
for (CronTrigger ct : [
    SELECT Id FROM CronTrigger
    WHERE CronJobDetail.Name = 'VF Nightly Archive' WITH SYSTEM_MODE
]) {
    System.abortJob(ct.Id);
}
```

## 7. Symptom to action table

| Symptom | First query | Likely cause | Action |
| --- | --- | --- | --- |
| `LimitException` on `Database.executeBatch` | `COUNT(Id)` of `AsyncApexJob` with `Status = 'Holding'` | flex queue at 100, or 5 concurrent batch jobs without the flex queue | wait, reprioritise with `System.FlexQueue`, or move the workload to Cursors + Queueable |
| `AsyncApexExecutions Limit exceeded` | `sf org list limits` -> `DailyAsyncApexExecutions` | rolling 24-hour async budget exhausted, often from an unbounded queueable chain | bound the chain with `AsyncOptions.MaximumQueueableStackDepth`, add a delay, or enable Elastic Limits (Beta) |
| Batch job `Status = Failed`, zero chunks processed | `ExtendedStatus` on the parent job | `QueryLocator` above 50 million rows, or an error in `start` | narrow the locator's `WHERE` clause; see skill `sf-soql-sosl-optimization` |
| Batch job `Completed` with `NumberOfErrors > 0` | `ExtendedStatus`, then `ParentJobId` children | per-chunk unhandled exceptions | implement `Database.RaisesPlatformEvents` and subscribe to `BatchApexErrorEvent` to retry only failing records |
| Queueable disappears silently | `AsyncApexJob WHERE JobType = 'Queueable'` | enqueuing transaction rolled back, so the job was never processed | move the enqueue out of the failing transaction, or publish an event instead |
| Queueable fails with no trace | none - nothing is logged | no finalizer attached | attach a `Finalizer` and persist `ctx.getException()` |
| `DuplicateMessageException` on enqueue | none | an equivalent job with the same duplicate signature is already enqueued | expected behaviour: catch and skip |
| Scheduled job never fires | `CronTrigger.State`, `NextFireTime` | `BLOCKED` (previous instance still running), `ERROR`, or `PAUSED` during a release | shorten the job, or widen the schedule interval |
| Deployment fails: `This schedulable class has jobs pending or in progress` | `CronTrigger WHERE CronJobDetail.JobType = '7'` | active schedule for the class being deployed | abort the job, deploy, reschedule. See skill `sf-deployment-strategies` |
| `System.AsyncException: The Apex job named "X" is already scheduled for execution` | `CronJobDetail WHERE Name = 'X'` | duplicate scheduled job name | abort the existing job or pick a unique name |
| Event subscriber stops receiving events | `EventBusSubscriber WHERE Status != 'Running'` | retry cap exhausted (`Error`) or admin suspension (`Suspended`) | fix and save the trigger; accept that events published during the outage are lost |
| Event subscriber lag grows | `LastPublished` minus `LastProcessed` | batch size too small, trigger too slow, or a single subscription | raise `batchSize` in `PlatformEventSubscriberConfig`, optimise the trigger, then configure parallel subscriptions |
| Cursor job throws `System.TransientCursorException` | `AsyncApexJob` for the queueable | transient cursor failure | re-enqueue from the finalizer; the exception is retryable |
| Cursor job throws `System.FatalCursorException` | same | non-retryable cursor failure | rebuild the cursor from a fresh `Database.getCursor` call |

## 8. Post-deploy verification snippets

```bash
# vibe-force smoke gate: anonymous Apex probes plus data queries
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" smoke --target-org vf-uat

# Confirm no async job failed since the deploy
sf data query --target-org vf-uat --query "SELECT COUNT(Id) FROM AsyncApexJob WHERE CreatedDate = TODAY AND (Status = 'Failed' OR NumberOfErrors > 0) AND JobType != 'BatchApexWorker'"

# Confirm scheduled jobs survived the deploy
sf data query --target-org vf-uat --query "SELECT CronJobDetail.Name, State, NextFireTime FROM CronTrigger WHERE CronJobDetail.JobType = '7'"

# Confirm event subscribers are running
sf data query --target-org vf-uat --query "SELECT Topic, Name, Status FROM EventBusSubscriber WHERE Status != 'Running'"
```

Expected results: zero failed jobs, every scheduled job in `WAITING` or `ACQUIRED` with a future
`NextFireTime`, and an empty subscriber-error result set. See skill `sf-post-deploy-verification` for
how these probes are wired into the `smoke` and `verify` checks, and skill `sf-debugging-logs` for
capturing debug logs from async contexts.

## 9. Source URLs

- https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_asyncapexjob.htm
- https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_crontrigger.htm
- https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_cronjobdetail.htm
- https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_eventbussubscriber.htm
- https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_flexqueueitem.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_batch_interface.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_scheduler.htm
- https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_data_commands_unified.htm
- PDF snapshots used while authoring: https://resources.docs.salesforce.com/264/latest/en-us/sfdc/pdf/object_reference.pdf and https://resources.docs.salesforce.com/264/latest/en-us/sfdc/pdf/sfdx_cli_reference.pdf
