# Queueable Apex and Transaction Finalizers - Reference

Source of record: Apex Developer Guide, topics `apex_queueing_jobs`, `apex_dedupe_queueable`,
`apex_transaction_finalizers`, `apex_transaction_finalizers_error_messages`, `apex_gov_limits`.
URLs listed at the end of this file.

## 1. Interfaces and marker interfaces

| Type | Required member | Purpose |
| --- | --- | --- |
| `Queueable` | `void execute(QueueableContext context)` | the unit of async work |
| `Database.AllowsCallouts` | none (marker) | permits HTTP and web-service callouts from the job **and from its chained children** |
| `Database.Stateful` | none (marker) | not applicable to `Queueable`; queueable member state is always serialized |
| `Finalizer` | `void execute(FinalizerContext ctx)` | post-action sequence, runs after the queueable in a separate transaction |
| `QueueableContext` | `Id getJobId()` | the `AsyncApexJob` id of the running job |

A single class may implement both `Queueable` and `Finalizer`. A finalizer may also be an inner class.

## 2. Enqueue overloads

| Call | Returns | Notes |
| --- | --- | --- |
| `System.enqueueJob(queueable)` | `Id` of the new `AsyncApexJob` | execution may be delayed by service availability |
| `System.enqueueJob(queueable, delayInMinutes)` | `Id` | delay 0-10 minutes; ignored during Apex tests; **ignores** the org-wide enqueue delay setting |
| `System.enqueueJob(queueable, asyncOptions)` | `Id` | carries `MaximumQueueableStackDepth`, `MinimumQueueableDelayInMinutes`, `DuplicateSignature` |

Org-wide default delay: Setup -> Apex Settings -> *Default minimum enqueue delay (in seconds) for
queueable jobs that do not have a delay parameter*, range 1-600 seconds. Also settable through the
`ApexSettings` Metadata API type.

## 3. `AsyncOptions` and `System.AsyncInfo`

| Member | Type | Meaning |
| --- | --- | --- |
| `AsyncOptions.MaximumQueueableStackDepth` | `Integer` | ceiling for the chained-job stack depth |
| `AsyncOptions.MinimumQueueableDelayInMinutes` | `Integer` | minimum delay before the job runs |
| `AsyncOptions.DuplicateSignature` | `QueueableDuplicateSignature` | de-duplication key |
| `AsyncInfo.hasMaxStackDepth()` | `Boolean` | true when a max stack depth was set on the request |
| `AsyncInfo.getCurrentQueueableStackDepth()` | `Integer` | 1 for the parent job, 2 for its child, and so on |
| `AsyncInfo.getMaximumQueueableStackDepth()` | `Integer` | configured ceiling |
| `AsyncInfo.getMinimumQueueableDelayInMinutes()` | `Integer` | configured delay |

Bounded self-chaining, adapted from the Fibonacci example in the Apex Developer Guide:

```apex
public with sharing class FibonacciDepthQueueable implements Queueable {
    private Long nMinus1;
    private Long nMinus2;

    public static void calculateFibonacciTo(Integer depth) {
        AsyncOptions asyncOptions = new AsyncOptions();
        asyncOptions.MaximumQueueableStackDepth = depth;
        System.enqueueJob(new FibonacciDepthQueueable(null, null), asyncOptions);
    }

    private FibonacciDepthQueueable(Long nMinus1param, Long nMinus2param) {
        nMinus1 = nMinus1param;
        nMinus2 = nMinus2param;
    }

    public void execute(QueueableContext context) {
        Integer depth = AsyncInfo.getCurrentQueueableStackDepth();
        Long step;
        switch on (depth) {
            when 1, 2 { step = 1; }
            when else { step = nMinus1 + nMinus2; }
        }
        if (System.AsyncInfo.hasMaxStackDepth()
                && AsyncInfo.getCurrentQueueableStackDepth()
                   >= AsyncInfo.getMaximumQueueableStackDepth()) {
            insert as user new Fibonacci__c(Depth__c = depth, Result__c = step);
        } else {
            System.enqueueJob(new FibonacciDepthQueueable(step, nMinus1));
        }
    }
}
```

## 4. Duplicate signatures

`QueueableDuplicateSignature.Builder` methods:

| Method | Purpose |
| --- | --- |
| `addString(inputString)` | append a string component |
| `addId(inputId)` | append an id component |
| `addInteger(inputInteger)` | append an integer component |
| `getSize()` | current signature size in bytes |
| `getRemainingSize()` | remaining bytes |
| `getMaxSize()` | maximum signature size in bytes |
| `build()` | produce the `QueueableDuplicateSignature` |

Behaviour:

- Enqueuing a second job whose signature matches an **enqueued** job throws
  `DuplicateMessageException` with the message
  `Attempt to enqueue job with duplicate queueable signature`.
- The signature is removed from the job when it is first dequeued. A job that is already **running**
  no longer holds a signature, so a duplicate can still be enqueued at that point. This guarantees at
  least one instance per signature runs; it does not guarantee at most one.

```apex
AsyncOptions options = new AsyncOptions();
options.DuplicateSignature = QueueableDuplicateSignature.Builder()
    .addInteger(System.hashCode(someAccount))
    .addId([SELECT Id FROM ApexClass WHERE Name = 'MyQueueable' WITH SYSTEM_MODE].Id)
    .build();
System.enqueueJob(new MyQueueable(), options);
```

## 5. Queueable limits

| Limit | Value |
| --- | --- |
| `System.enqueueJob` calls per synchronous transaction | 50 |
| `System.enqueueJob` calls per asynchronous transaction (for example from Batch Apex) | 1 |
| Child jobs per executing queueable | 1 |
| Chained stack depth, Developer and Trial Editions | 5 total (parent + 4 children) |
| Chained stack depth, other editions | no enforced depth limit |
| Enqueue calls remaining in this transaction | `Limits.getQueueableJobs()` / `Limits.getLimitQueueableJobs()` |
| Async executions charged per queueable run | 1 against the shared org async limit |
| Org async executions per rolling 24 hours | 250,000 or user licences x 200, whichever is greater |
| Minimum enqueue delay range | 0-10 minutes (`enqueueJob(queueable, delay)`) |
| Org-wide default enqueue delay range | 1-600 seconds (Apex Settings) |
| Heap size, asynchronous | 25 MB (synchronous is 10 MB) |
| CPU time, asynchronous | 60,000 ms (synchronous is 10,000 ms) |
| SOQL queries, asynchronous | 200 (synchronous is 100) |
| Maximum execution time per Apex transaction | 10 minutes |
| Bulk API transactions | effective limit is the higher of sync and async, so 50 enqueues |

Notes:

- If the enqueuing transaction rolls back, queued queueable jobs are **not** processed.
- `transient` members are skipped by serialization and arrive as `null` inside `execute`.
- Queueable jobs do not process batches, so `JobItemsProcessed` and `TotalJobItems` on the
  `AsyncApexJob` row are always zero.
- Orgs may opt into *Elastic Limits for Asynchronous Apex Jobs* (Beta) to have work above the rolling
  24-hour limit processed at a throttled rate instead of failing.

## 6. Finalizers

Attach exactly once, from inside a queueable `execute`:

```apex
System.attachFinalizer(new MyFinalizer());
// or, when the class implements both interfaces
System.attachFinalizer(this);
```

`System.FinalizerContext` members:

| Method | Returns | Meaning |
| --- | --- | --- |
| `getAsyncApexJobId()` | `Id` | the parent queueable's `AsyncApexJob` id; use this to correlate with `AsyncApexJob` |
| `getRequestId()` | `String` | unique request id shared by the queueable and the finalizer; correlates with Event Monitoring logs |
| `getResult()` | `System.ParentJobResult` | `SUCCESS` or `UNHANDLED_EXCEPTION` |
| `getException()` | `System.Exception` | the failing exception when the result is `UNHANDLED_EXCEPTION`, otherwise `null` |

Implementation rules:

- One finalizer instance per queueable job.
- The finalizer may enqueue **one** async job (Queueable, Future, or Batch).
- Callouts are allowed in a finalizer.
- The framework serializes the finalizer state as it exists at the *end* of queueable execution, so
  mutating the finalizer after `attachFinalizer` is supported and is the basis of the buffered-logging
  pattern.
- `transient` members do not persist into the finalizer.
- The queueable and its finalizer run in separate Apex and database transactions - the queueable can
  do DML while the finalizer does REST callouts.
- Running a finalizer does not consume an extra daily async execution.
- Synchronous governor limits apply to the finalizer transaction, **except** total heap size, maximum
  `System.enqueueJob` additions, and maximum `@future` methods per invocation, which use the
  asynchronous values.
- A queueable that failed with an unhandled exception can be re-enqueued by its finalizer up to five
  consecutive times. The counter resets when a run completes without an unhandled exception.
- If a request terminates unexpectedly (for example a database shutdown during a system upgrade) the
  finalizer can fail to execute. Do not rely on the finalizer as the only durability mechanism.
- ISVs should avoid `global` finalizers with state-mutating methods; subscriber code calling those
  methods can change finalizer behaviour unexpectedly.

### Buffered logging finalizer

```apex
public with sharing class LoggingFinalizer implements Finalizer, Queueable {
    private List<LogMessage__c> logRecords = new List<LogMessage__c>();

    public void execute(QueueableContext ctx) {
        LoggingFinalizer f = new LoggingFinalizer();
        System.attachFinalizer(f);
        f.addLog('About to do some work...', String.valueOf(ctx.getJobId()));
        // ... work that may blow a governor limit ...
    }

    public void execute(FinalizerContext ctx) {
        for (LogMessage__c log : logRecords) {
            log.Request__c = ctx.getAsyncApexJobId();
        }
        Database.insert(logRecords, false);
        if (ctx.getResult() != ParentJobResult.SUCCESS) {
            System.debug(LoggingLevel.ERROR,
                'Parent job failed: ' + ctx.getException().getMessage());
        }
    }

    public void addLog(String message, String source) {
        logRecords.add(new LogMessage__c(
            DateTime__c = DateTime.now(),
            Message__c = message,
            Source__c = source
        ));
    }
}
```

### Retry finalizer with the 5-attempt cap

```apex
public with sharing class RetryLimitDemo implements Finalizer, Queueable {
    public void execute(QueueableContext ctx) {
        System.attachFinalizer(new RetryLimitDemo());
        // work that fails
    }

    public void execute(FinalizerContext ctx) {
        if (ctx.getResult() == ParentJobResult.SUCCESS) {
            return;
        }
        // Fails after 5 consecutive re-enqueues (queueable chaining retry limit).
        System.enqueueJob(new RetryLimitDemo());
    }
}
```

## 7. Finalizer error messages

Apex debug log:

| Error message | Failed context | Cause |
| --- | --- | --- |
| `More than one Finalizer cannot be attached to same Async Apex Job` | Queueable execution | `System.attachFinalizer()` invoked more than once in the same queueable instance |
| `Class {0} must implement the Finalizer interface` | Queueable execution | the argument class does not implement `System.Finalizer` |
| `System.attachFinalizer(Finalizer) is not allowed in this context` | non-queueable execution | called outside a queueable |
| `Invalid number of parameters` | Queueable execution | wrong parameter count passed to `System.attachFinalizer()` |
| `Argument cannot be null` | Queueable execution | `System.attachFinalizer(null)` |

Splunk Add-On for Salesforce log:

| Error message | Cause |
| --- | --- |
| `Error processing finalizer for queueable job id: {0}` | runtime error in the finalizer: unhandled catchable exception, uncatchable exception such as `LimitException`, or an internal system error |
| `Error processing the finalizer (class name: {0}) for the queueable job id: {1} (queueable class id: {2})` | same causes, with class identification |

## 8. Future methods (legacy)

Salesforce recommends Queueable over `@future`. Retained facts for migration work:

| Constraint | Value |
| --- | --- |
| Method modifiers | `static`, return type `void` |
| Parameter types | primitives, arrays of primitives, collections of primitives; **no** sObjects or custom objects |
| Callouts | require `@future(callout=true)` |
| Nested futures | a future method cannot invoke another future method |
| Futures per Apex invocation, synchronous | 50 |
| Futures per Apex invocation, from batch or future context | 0 |
| Futures per Apex invocation, from queueable context | 50 |
| Daily executions | shared 250,000 / licences x 200 org async limit |
| Rollback | futures queued by a rolled-back transaction are not processed |

Migration mapping:

| `@future` construct | Queueable replacement |
| --- | --- |
| `@future public static void run(List<Id> ids)` | `Queueable` class with a `List<Id>` member |
| `@future(callout=true)` | `implements Queueable, Database.AllowsCallouts` |
| no job id available | `Id jobId = System.enqueueJob(...)` |
| primitives only | any serializable member, including sObjects and custom types |
| no chaining | `System.enqueueJob` from inside `execute` |
| no failure hook | `System.attachFinalizer` |

`@future` remains the documented way to isolate mixed DML (for example inserting a `User` with a role
in the same request as an `Account` insert), because the future method runs in its own transaction.

## 9. Testing pointers

Full mechanics live in skill `sf-apex-testing`. Minimum contract:

- Enqueue inside `Test.startTest()` / `Test.stopTest()`; all async work started in the block runs
  synchronously after `stopTest()`.
- Only one level of chaining executes in a test context; assert on the first job's effects and test
  child jobs separately.
- `System.enqueueJob(queueable, delay)` ignores the delay in tests.
- Tests cannot call `System.schedule()` or `System.enqueueJob()` from a test **setup** method.
- Async calls inside `startTest`/`stopTest` do not count against the queued-job limits.

## 10. Source URLs

- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_queueing_jobs.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_dedupe_queueable.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_transaction_finalizers.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_transaction_finalizers_error_messages.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_invoking_future_methods.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_annotation_future.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm
- PDF snapshot used while authoring: https://resources.docs.salesforce.com/264/latest/en-us/sfdc/pdf/salesforce_apex_developer_guide.pdf
